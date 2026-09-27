#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

function arg(name, fallback = null) {
  const eq = `--${name}=`;
  const found = process.argv.find(a => a.startsWith(eq));
  return found ? found.slice(eq.length) : fallback;
}

const port = Number(arg('port', '9224'));
const out = arg('out', 'acceptance-checkpoints/scroll-performance-trace-report.json');
const traceDir = arg('traceDir', 'acceptance-checkpoints/scroll-traces');
const durationMs = Number(arg('durationMs', '20000'));
const modes = String(arg('modes', 'synthetic,wheel')).split(',').map(s => s.trim()).filter(Boolean);
const scenarios = String(arg('scenarios', 'A,B,C')).split(',').map(s => s.trim()).filter(Boolean);

function getJson(route) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: route }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => { body += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (err) { reject(new Error(`Bad JSON ${route}: ${err.message}\n${body.slice(0, 500)}`)); }
      });
    }).on('error', reject);
  });
}

async function waitForDashboard(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const targets = await getJson('/json');
      const page = targets.find(t => t.type === 'page' && t.webSocketDebuggerUrl && /dashboard\.html|Baddel Launcher/i.test(`${t.url} ${t.title}`));
      if (page) return page;
    } catch (err) { lastErr = err; }
    await new Promise(r => setTimeout(r, 500));
  }
  throw lastErr || new Error('Dashboard CDP target not found');
}

function connect(wsUrl) {
  let nextId = 1;
  const pending = new Map();
  const events = [];
  const ws = new WebSocket(wsUrl);
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      else resolve(msg.result);
      return;
    }
    events.push(msg);
  };
  const open = new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error('WebSocket error'));
  });
  return {
    events,
    async send(method, params = {}) {
      await open;
      const id = nextId++;
      ws.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    close() { try { ws.close(); } catch {} },
  };
}

async function evaluate(client, expression, timeoutMs = 120000) {
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error(`Runtime.evaluate timeout ${timeoutMs}ms`)), timeoutMs));
  const result = await Promise.race([
    client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: timeoutMs }),
    timeout,
  ]);
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || JSON.stringify(result.exceptionDetails));
  }
  return result.result?.value;
}

async function activateDashboard(targetId) {
  try { await getJson(`/json/activate/${targetId}`); } catch {}
}

async function startTrace(client) {
  await client.send('Tracing.start', {
    transferMode: 'ReturnAsStream',
    categories: [
      'devtools.timeline',
      'disabled-by-default-devtools.timeline',
      'disabled-by-default-devtools.timeline.frame',
      'blink',
      'cc',
      'gpu',
      'toplevel',
      'loading',
      'v8',
    ].join(','),
    options: 'sampling-frequency=10000',
  });
}

async function stopTrace(client) {
  const complete = new Promise((resolve, reject) => {
    const start = Date.now();
    const poll = () => {
      const idx = client.events.findIndex(e => e.method === 'Tracing.tracingComplete');
      if (idx >= 0) return resolve(client.events.splice(idx, 1)[0].params);
      if (Date.now() - start > 60000) return reject(new Error('Tracing.tracingComplete timeout'));
      setTimeout(poll, 100);
    };
    poll();
  });
  await client.send('Tracing.end');
  const params = await complete;
  const stream = params.stream;
  let data = '';
  if (stream) {
    while (true) {
      const chunk = await client.send('IO.read', { handle: stream });
      data += chunk.data || '';
      if (chunk.eof) break;
    }
    try { await client.send('IO.close', { handle: stream }); } catch {}
  }
  return JSON.parse(data || '{"traceEvents":[]}');
}

function summarize(values) {
  const list = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!list.length) return { count: 0, totalMs: 0, avgMs: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0, maxMs: 0 };
  const pct = p => list[Math.min(list.length - 1, Math.max(0, Math.ceil((p / 100) * list.length) - 1))];
  const total = list.reduce((a, b) => a + b, 0);
  const r = n => Math.round(n * 100) / 100;
  return { count: list.length, totalMs: r(total), avgMs: r(total / list.length), p50Ms: r(pct(50)), p95Ms: r(pct(95)), p99Ms: r(pct(99)), maxMs: r(list[list.length - 1]) };
}

function isName(name, patterns) {
  return patterns.some(p => p instanceof RegExp ? p.test(name) : p === name);
}

function analyzeTrace(trace) {
  const events = Array.isArray(trace.traceEvents) ? trace.traceEvents : [];
  const complete = events.filter(e => e.ph === 'X' && Number.isFinite(e.dur));
  const durMs = e => e.dur / 1000;
  const bucket = (patterns) => complete.filter(e => isName(e.name || '', patterns)).map(durMs);
  const names = complete.reduce((m, e) => (m[e.name] = (m[e.name] || 0) + (e.dur || 0), m), {});
  const topNames = Object.entries(names).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([name, dur]) => ({ name, totalMs: Math.round(dur / 10) / 100 }));
  return {
    eventCount: events.length,
    topNames,
    frame: summarize(bucket([/^Frame$/i, /DrawFrame/i, /BeginFrame/i, /ThreadControllerImpl::RunTask/i])),
    paint: summarize(bucket([/^Paint$/, /^PrePaint$/, /PaintLayer/, /PaintArtifact/, /UpdateLayoutTree/])),
    rasterTask: summarize(bucket([/RasterTask/i, /RasterBuffer/i, /Rasterize/i])),
    imageDecode: summarize(bucket([/Decode Image/i, /Image Decode/i, /DecodeImage/i, /ImageDecoder/i, /PaintImage/i])),
    updateLayerTree: summarize(bucket([/UpdateLayerTree/i, /LayerTreeHost::UpdateLayers/i, /Commit/i])),
    compositeLayers: summarize(bucket([/CompositeLayers/i, /DrawFrame/i, /ActivateLayerTree/i, /SubmitCompositorFrame/i])),
    layout: summarize(bucket([/^Layout$/, /UpdateLayout/i, /LayoutView/i])),
    recalcStyle: summarize(bucket([/Recalculate Style/i, /^ScheduleStyleRecalculation$/i, /UpdateStyle/i])),
    gpu: summarize(complete.filter(e => /gpu|viz|compositor/i.test(`${e.cat || ''} ${e.name || ''}`)).map(durMs)),
  };
}

function scenarioExpression(scenario, mode, durationMs) {
  const suppress = scenario === 'C';
  const baseScenario = scenario === 'C' ? 'B' : scenario;
  return `
(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  if (typeof navigateToAllGames === 'function') navigateToAllGames();
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (typeof window.__runAllGamesScrollDiagnostic === 'function' && window._vs?.items?.length > 0) break;
    await wait(250);
  }
  const grid = document.getElementById('allGamesGrid');
  const scroller = window._vs?.scroller || document.getElementById('mainContentArea');
  const original = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
  const assignStats = { total: 0, sameSrc: 0, suppressed: 0, visible: 0, near: 0, far: 0, overscan: 0, predecode: 0, dom: 0, completeTrue: 0, naturalWidthPositive: 0, samples: [] };
  const visibleWindow = () => {
    const vs = window._vs || {};
    const rel = Math.max(0, Number(scroller?.scrollTop || 0) - Number(vs._gridTop || 0));
    const first = Math.max(0, Math.floor(rel / Math.max(1, Number(vs.rowH || 1))));
    const last = Math.ceil((rel + Number(scroller?.clientHeight || 0)) / Math.max(1, Number(vs.rowH || 1)));
    return { first, last };
  };
  function installSuppression() {
    if (!original?.set || !original?.get) return false;
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      configurable: true,
      enumerable: original.enumerable,
      get: original.get,
      set(value) {
        const current = original.get.call(this) || '';
        const next = String(value || '');
        const card = this.closest?.('.game-card');
        const row = card?.parentElement;
        const rowIdx = Number(row?.dataset?.rowIndex ?? row?.style?.top?.replace('px',''));
        const visible = visibleWindow();
        const logicalRow = Number.isFinite(rowIdx) && rowIdx > 100 ? Math.round(rowIdx / Math.max(1, Number(window._vs?.rowH || 1))) : rowIdx;
        const isVisible = Number.isFinite(logicalRow) && logicalRow >= visible.first && logicalRow <= visible.last;
        const distance = Number.isFinite(logicalRow) ? (logicalRow < visible.first ? visible.first - logicalRow : (logicalRow > visible.last ? logicalRow - visible.last : 0)) : null;
        const isNear = !isVisible && distance !== null && distance <= 2;
        assignStats.total++;
        if (current === next) assignStats.sameSrc++;
        if (card) {
          assignStats.dom++;
          if (isVisible) assignStats.visible++;
          else if (isNear) assignStats.near++;
          else assignStats.far++;
          if (!isVisible) assignStats.overscan++;
        } else {
          assignStats.predecode++;
        }
        if (this.complete) assignStats.completeTrue++;
        if (Number(this.naturalWidth || 0) > 0) assignStats.naturalWidthPositive++;
        if (assignStats.samples.length < 20) assignStats.samples.push({ current, next, isVisible, isNear, isPredecode: !card, complete: this.complete, naturalWidth: this.naturalWidth || 0, row: logicalRow, id: card?.dataset?.id || null });
        ${suppress ? "assignStats.suppressed++; return;" : "return original.set.call(this, value);"}
      }
    });
    return true;
  }
  const installed = installSuppression();
  try {
    if ('${mode}' === 'synthetic') {
      const report = await window.__runAllGamesScrollDiagnostic({ durationMs: ${durationMs}, scenarios: ['${baseScenario}'] });
      return { scenario: '${scenario}', baseScenario: '${baseScenario}', mode: '${mode}', suppressImgSrc: ${JSON.stringify(suppress)}, installed, report, assignStats, hidden: document.hidden };
    }
    const cleanupScenario = (typeof _agScrollDiagnosticApplyScenario === 'function') ? _agScrollDiagnosticApplyScenario('${baseScenario}') : (() => {});
    try {
      window.__agScrollDiagnosticActive = { scenario: '${baseScenario}', startedAt: performance.now(), counters: {}, samples: { frameDurations: [] }, ranges: [], snapshots: [], max: {} };
      scroller.scrollTop = 0;
      if (typeof window._vsRender === 'function') window._vsRender(false, 'trace-wheel-start');
      await wait(500);
      const frames = [];
      let last = null;
      let stop = false;
      function frame(ts) { if (last != null) frames.push(ts - last); last = ts; if (!stop) requestAnimationFrame(frame); }
      requestAnimationFrame(frame);
      const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      const steps = Math.max(120, Math.floor(${durationMs} / 16));
      for (let i = 0; i < steps; i++) {
        const phase = i / Math.max(1, steps - 1);
        const down = phase <= 0.5;
        const local = down ? phase * 2 : (1 - phase) * 2;
        const delta = down ? 560 : -560;
        try {
          window.dispatchEvent(new WheelEvent('wheel', { deltaY: delta, bubbles: true, cancelable: true }));
          scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: delta, bubbles: true, cancelable: true }));
        } catch {}
        scroller.scrollTop = down ? maxScroll * local : maxScroll * local;
        scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
        await wait(16);
      }
      stop = true;
      await wait(500);
      const counters = window.__agScrollDiagnosticActive?.counters || {};
      window.__agScrollDiagnosticActive = null;
      return { scenario: '${scenario}', baseScenario: '${baseScenario}', mode: '${mode}', suppressImgSrc: ${JSON.stringify(suppress)}, installed, wheel: { frameCount: frames.length, frameSummary: (${summarize.toString()})(frames), counters, scrollTop: scroller.scrollTop, maxScroll }, assignStats, hidden: document.hidden };
    } finally { cleanupScenario(); window.__agScrollDiagnosticActive = null; }
  } finally {
    if (installed && original) Object.defineProperty(HTMLImageElement.prototype, 'src', original);
  }
})()`;
}

(async () => {
  fs.mkdirSync(traceDir, { recursive: true });
  const target = await waitForDashboard();
  await activateDashboard(target.id);
  const client = connect(target.webSocketDebuggerUrl);
  const reports = [];
  try {
    await client.send('Runtime.enable');
    await client.send('Page.enable').catch(() => {});
    await client.send('Page.bringToFront').catch(() => {});
    const rafCheck = await evaluate(client, `new Promise(resolve=>{let n=0; const start=performance.now(); function f(){n++; if(performance.now()-start>500) resolve({n, hidden:document.hidden}); else requestAnimationFrame(f);} requestAnimationFrame(f); setTimeout(()=>resolve({timeout:true,n,hidden:document.hidden}),2000);})`, 5000);
    if (!rafCheck || rafCheck.hidden || rafCheck.n < 10) throw new Error(`rAF is not active: ${JSON.stringify(rafCheck)}`);
    for (const mode of modes) {
      for (const scenario of scenarios) {
        const name = `${mode}-${scenario}`;
        await activateDashboard(target.id);
        await client.send('Page.bringToFront').catch(() => {});
        await evaluate(client, `window.focus(); ({ hidden: document.hidden, hasFocus: document.hasFocus() })`, 5000).catch(() => null);
        const visibilityCheck = await evaluate(client, `new Promise(resolve=>{let n=0; const start=performance.now(); function f(){n++; if(performance.now()-start>300) resolve({n, hidden:document.hidden, hasFocus:document.hasFocus()}); else requestAnimationFrame(f);} requestAnimationFrame(f); setTimeout(()=>resolve({timeout:true,n,hidden:document.hidden,hasFocus:document.hasFocus()}),1500);})`, 3000);
        if (!visibilityCheck || visibilityCheck.hidden || visibilityCheck.n < 5) {
          throw new Error(`${name} rAF/visibility is not active: ${JSON.stringify(visibilityCheck)}`);
        }
        await startTrace(client);
        const runtime = await evaluate(client, scenarioExpression(scenario, mode, durationMs), Math.max(120000, durationMs + 90000));
        const trace = await stopTrace(client);
        const tracePath = path.join(traceDir, `${name}.json`);
        fs.writeFileSync(tracePath, JSON.stringify(trace));
        reports.push({ name, mode, scenario, tracePath, runtime, traceSummary: analyzeTrace(trace) });
        fs.writeFileSync(out + '.partial', JSON.stringify({ marker: 'BADDEL_CHROMIUM_SCROLL_TRACE_PARTIAL', updatedAt: new Date().toISOString(), port, durationMs, reports }, null, 2));
      }
    }
  } finally {
    client.close();
  }
  const result = { marker: 'BADDEL_CHROMIUM_SCROLL_TRACE', startedAt: new Date().toISOString(), port, durationMs, reports };
  fs.writeFileSync(out, JSON.stringify(result, null, 2));
  console.log(`BADDEL_CHROMIUM_SCROLL_TRACE_WRITTEN ${out}`);
})().catch(err => { console.error(err.stack || err.message || String(err)); process.exit(1); });

