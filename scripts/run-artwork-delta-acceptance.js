const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => body += c);
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`HTTP ${res.statusCode}: ${body}`));
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => req.destroy(new Error('timeout')));
  });
}
async function cdpEval(expression, timeout = 360000) {
  const port = arg('port', '9224');
  const targets = await getJson(`http://127.0.0.1:${port}/json`);
  const page = targets.find(t => t.type === 'page' && /dashboard\.html|Baddel Launcher/i.test(`${t.url} ${t.title}`)) || targets.find(t => t.type === 'page');
  if (!page) throw new Error('No page target');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 1;
  const pending = new Map();
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const msgId = id++;
    pending.set(msgId, { resolve, reject });
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error.message));
    else p.resolve(msg.result);
  };
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('ws failed')); });
  try {
    await call('Runtime.enable');
    const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Runtime exception');
    return result.result.value;
  } finally {
    try { ws.close(); } catch {}
  }
}
function readManifestAliases(named) {
  const userData = arg('userData', 'C:/Users/TestUser/AppData/Roaming/baddel-launcher-beta');
  const manifestPath = path.join(userData, 'artwork-cache-v2', 'manifest.json');
  let manifest = { assets: {}, aliases: {} };
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch {}
  for (const item of named || []) {
    const aliases = new Set([item.canonicalArtworkKey, ...(item.allAliasesTried || [])].filter(Boolean).map(String));
    const textual = String(item.name || '').toLowerCase();
    const matches = [];
    for (const [alias, entry] of Object.entries(manifest.aliases || {})) {
      const base = alias.replace(/:cover$/, '');
      const textHit = textual && alias.toLowerCase().includes(textual === 'control' ? 'calluna' : textual);
      if (!aliases.has(base) && !aliases.has(alias) && !textHit) continue;
      const asset = manifest.assets?.[entry.assetHash] || null;
      const filePath = asset?.fileName ? path.join(userData, 'artwork-cache-v2', 'assets', asset.fileName) : null;
      matches.push({ alias, assetHash: entry.assetHash, fileName: asset?.fileName || null, exists: filePath ? fs.existsSync(filePath) : false, bytes: asset?.bytes || 0, artworkClass: asset?.artworkClass || null });
    }
    item.manifestAliases = matches;
  }
  return named;
}

const expression = `(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const scroll = ${arg('scroll', '1') === '1' ? 'true' : 'false'};
  const namedTitles = ['Fortnite', 'Control'];
  const stats = () => window.electronAPI.getArtworkDownloadStats();
  const jobs = () => Number(window._agT1Active || 0) + Number(window._agT2Active || 0) + Number(window._agT3Active || 0) + Number((window._agViewportCoverQueue || []).length) + Number((window._agBufferCoverQueue || []).length) + Number((window._agBackgroundCoverQueue || []).length) + Number(window.__agArtworkPersistenceEvidence?.pendingEnrichment || 0);
  const waitGrid = async () => {
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      if (window._vs && Array.isArray(window._vs.items) && window._vs.items.length) return true;
      await wait(250);
    }
    return false;
  };
  const waitIdle = async (timeoutMs = 240000) => {
    const start = performance.now();
    let last = null;
    let stable = 0;
    while (performance.now() - start < timeoutMs) {
      await wait(1000);
      const s = await stats();
      const active = Number(s.activeDownloads || s.schedulerSnapshot?.active || 0);
      const queued = Number(s.queuedDownloads || (Array.isArray(s.schedulerSnapshot?.pending) ? s.schedulerSnapshot.pending.length : 0));
      const j = jobs();
      last = { stats: s, active, queued, jobs: j, readyArtworkCount: Array.from(window.__agArtworkRegistry?.values?.() || []).filter(r => r && r.status === 'ready' && r.localUrl).length, totalGames: Array.isArray(window._vs?.items) ? window._vs.items.length : 0 };
      if (active === 0 && queued === 0 && j === 0) stable += 1; else stable = 0;
      if (stable >= 5) break;
    }
    return { durationMs: performance.now() - start, last };
  };
  const rendererEvidence = () => typeof _agArtworkPersistenceRendererEvidence === 'function' ? _agArtworkPersistenceRendererEvidence() : (window.__agArtworkPersistenceEvidence || {});
  const gameInputs = () => typeof _agArtworkPersistenceGameInputs === 'function' ? _agArtworkPersistenceGameInputs() : [];
  const lifecycle = label => ({ label, currentView: typeof currentView === 'undefined' ? null : currentView, allGamesItemCount: Array.isArray(window._vs?.items) ? window._vs.items.length : 0, collectedAt: new Date().toISOString() });
  const collectAudit = async label => window.electronAPI.getArtworkPersistenceAudit({ label, games: gameInputs(), rendererEvidence: rendererEvidence(), lifecycle: lifecycle(label) });
  const namedReport = async () => {
    const pools = [window._vs?.items, window._allGamesCache, window._allGamesRawCache, window.allGamesData].filter(Array.isArray);
    const flat = pools.flat();
    const result = [];
    for (const name of namedTitles) {
      const matches = flat.filter(g => String(g?.title || g?.name || '').toLowerCase() === name.toLowerCase());
      const unique = [];
      const seen = new Set();
      for (const g of matches) { const id = String(g?.id || g?.appName || ''); if (!id || seen.has(id)) continue; seen.add(id); unique.push(g); }
      for (const game of unique) {
        const canonicalArtworkKey = (() => { try { return _agArtworkKey(game); } catch { return null; } })();
        const allAliasesTried = (() => { try { return _agArtworkAliasesForGame(game); } catch { return []; } })();
        const remoteCoverCandidates = (() => { try { return _agArtworkCandidateUrlsFromGame(game); } catch { return []; } })();
        const lookupKey = canonicalArtworkKey || allAliasesTried[0] || String(game.id || '');
        const bulk = await window.electronAPI.getCachedImagesBulk([{ key: lookupKey, ids: allAliasesTried }], 'cover').catch(() => null);
        const localUrl = bulk?.images?.[lookupKey] || null;
        const fileExists = localUrl ? await window.electronAPI.probeLocalImage(localUrl).catch(() => false) : false;
        const record = canonicalArtworkKey && window.__agArtworkRegistry instanceof Map ? window.__agArtworkRegistry.get(canonicalArtworkKey) : null;
        result.push({
          name,
          platform: game.platform || game.platforms?.[0] || null,
          accountId: game.libraryAccountId || game.ownerAccountId || game.accountId || (Array.isArray(game.ownedByAccountIds) ? game.ownedByAccountIds[0] : null),
          productGameId: { id: game.id || null, appName: game.appName || null, namespace: game.namespace || game.allIds?.epic || null, catalogItemId: game.catalogItemId || null, offerId: game.offerId || null, allIds: game.allIds || null },
          canonicalArtworkKeyExpected: canonicalArtworkKey,
          canonicalArtworkKeyActuallyUsed: record?.cacheKey || canonicalArtworkKey,
          allAliasesTried,
          remoteCoverCandidates,
          aliasResolution: { hit: !!localUrl, localUrl, lookupKey, bulkStatus: bulk?.status || null },
          fileExists,
          registryStatus: record ? { status: record.status || null, localUrl: record.localUrl || null, attempts: record.attempts || 0, lastError: record.lastError || null } : null,
          reasonNotVisible: localUrl && fileExists ? 'covered_locally' : (remoteCoverCandidates.length ? 'not_yet_cached_or_alias_pending' : 'missing_source'),
        });
      }
    }
    return result;
  };
  if (typeof window.navigateToAllGames === 'function') await window.navigateToAllGames(); else if (typeof navigateToAllGames === 'function') await navigateToAllGames();
  await waitGrid();
  const idleBefore = await waitIdle();
  const baselineAudit = await collectAudit('delta-baseline-before-reset');
  const namedBeforeReset = await namedReport();
  const beforeStats = await stats();
  if (typeof window.__resetArtworkImageErrorDiagnostics === 'function') window.__resetArtworkImageErrorDiagnostics('post-idle-scroll-delta');
  await wait(250);
  const afterResetStats = await stats();
  let scrollInfo = null;
  if (scroll) {
    const scroller = window._vs?.scroller || document.getElementById('mainContentArea') || document.scrollingElement;
    const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const start = performance.now();
    for (let i = 0; i < 180; i++) { scroller.scrollTop = max * (i / 179); scroller.dispatchEvent(new Event('scroll', { bubbles: true })); await wait(16); }
    for (let i = 0; i < 180; i++) { scroller.scrollTop = max * (1 - i / 179); scroller.dispatchEvent(new Event('scroll', { bubbles: true })); await wait(16); }
    scrollInfo = { durationMs: performance.now() - start, maxScroll: max, finalScrollTop: scroller.scrollTop };
  }
  const idleAfter = await waitIdle(90000);
  await wait(1500);
  const postAudit = await collectAudit('delta-after-reset-scroll');
  const postStats = await stats();
  const namedAfter = await namedReport();
  return { marker: 'BADDEL_ARTWORK_DELTA_ACCEPTANCE', generatedAt: new Date().toISOString(), url: location.href, idleBefore, beforeStats, baselineAudit, namedBeforeReset, afterResetStats, scrollInfo, idleAfter, postAudit, postStats, rendererDelta: window.__agArtworkPersistenceEvidence || null, namedAfter };
})()`;

(async () => {
  const out = path.resolve(arg('out', 'acceptance-checkpoints/artwork-delta-acceptance.json'));
  const value = await cdpEval(expression, Number(arg('timeout', '420000')));
  value.namedBeforeReset = readManifestAliases(value.namedBeforeReset);
  value.namedAfter = readManifestAliases(value.namedAfter);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(value, null, 2));
  console.log(`ARTWORK_DELTA_ACCEPTANCE_WRITTEN ${out}`);
})().catch(err => { console.error(err.stack || err); process.exit(1); });
