const test = require('node:test');
const assert = require('node:assert/strict');

const { ColdCoverBootstrapService } = require('../src/features/games/infrastructure/services/ColdCoverBootstrapService');

test('Steam games with null covers use validated app IDs without waiting on metadata', async () => {
  const manager = makeManager();
  const service = new ColdCoverBootstrapService({ artworkDownloadManager: manager,
    metadataResolver: async () => { throw new Error('must not be needed'); } });
  const games = ['239140', '220240', '323190'].map(id => ({ id: `steam_${id}`, platform: 'steam', appName: id, coverUrl: null }));
  service.start(games);
  await service.whenIdle();
  assert.equal(service.getStats().metadataRequests, 0);
  assert.equal(service.getStats().jobsByState.ready, 3);
  assert.equal(manager.requests.length, 3);
  for (const request of manager.requests) assert.match(request.sourceUrl, /steamstatic.com\/store_item_assets\/steam\/apps\/\d+\/library_600x900.jpg$/);
  service.boost(games, { priority: 'visible' });
  await service.whenIdle();
  assert.equal(manager.requests.length, 3, 'cached covers are not downloaded again');
});

test('Steam poster failure still tries metadata and terminates without a loop', async () => {
  const manager = makeManager();
  const original = manager.requestAsset;
  manager.requestAsset = async args => args.sourceUrl.includes('steamstatic.com')
    ? { errorCode: 'HTTP_404' } : original(args);
  let calls = 0;
  const service = new ColdCoverBootstrapService({ artworkDownloadManager: manager,
    metadataResolver: async () => { calls++; return { cover: 'https://example.test/alternate.jpg' }; } });
  service.start([{ id: 'steam_6100', platform: 'steam', coverUrl: null }]);
  await service.whenIdle();
  assert.equal(calls, 1);
  assert.equal(service.getStats().jobsByState.ready, 1);
});

test('official Steam candidate is platform scoped and rejects malformed IDs', () => {
  const { _coverCandidatesFromGame } = require('../src/features/games/infrastructure/services/ColdCoverBootstrapService');
  for (const platform of ['epic', 'gog']) assert.deepEqual(_coverCandidatesFromGame({ platform, appName: '239140' }), []);
  for (const appName of ['../239140', '0', '239140?x=1']) assert.deepEqual(_coverCandidatesFromGame({ platform: 'steam', appName }), []);
  assert.equal(_coverCandidatesFromGame({ platform: 'steam', appName: '239140', coverUrl: 'https://example.test/existing.jpg' })[0], 'https://example.test/existing.jpg');
});

function makeGame(id, url = `https://cdn.example.test/${id}.jpg`, extra = {}) {
  return {
    id,
    platform: 'epic',
    coverCandidates: url ? [{ url, source: 'test' }] : [],
    ...extra,
  };
}

function makeManager({ existing = [], fail = new Map(), slow = false } = {}) {
  let assetSeq = 0;
  const aliases = new Map();
  const requests = [];
  const linked = [];
  const cacheHits = new Set(existing);
  for (const id of existing) aliases.set(`${id}|cover`, { fileUrl: `file:///cache/${id}.webp`, assetHash: `asset-${id}` });
  const manager = {
    requests,
    linked,
    transactions: [],
    getCachedAsset({ canonicalGameId, type }) {
      return aliases.get(`${canonicalGameId}|${type}`) || null;
    },
    linkCachedAlias({ assetHash, canonicalGameId, type }) {
      linked.push({ assetHash, canonicalGameId, type });
      aliases.set(`${canonicalGameId}|${type}`, { fileUrl: `file:///cache/${assetHash}.webp`, assetHash });
      return aliases.get(`${canonicalGameId}|${type}`);
    },
    async requestAsset({ sourceUrl, canonicalGameId, type, priority, reason }) {
      requests.push({ sourceUrl, canonicalGameId, type, priority, reason });
      if (slow) await new Promise(resolve => setTimeout(resolve, 40));
      if (fail.has(canonicalGameId)) {
        return { status: 'blocked', localUrl: null, errorCode: fail.get(canonicalGameId), blockedReason: fail.get(canonicalGameId) };
      }
      if (cacheHits.has(canonicalGameId)) {
        return { status: 'cache-hit', localUrl: `file:///cache/${canonicalGameId}.webp`, assetHash: `asset-${canonicalGameId}` };
      }
      const assetHash = `asset-${++assetSeq}`;
      aliases.set(`${canonicalGameId}|${type}`, { fileUrl: `file:///cache/${assetHash}.webp`, assetHash });
      return { status: 'downloaded', localUrl: `file:///cache/${assetHash}.webp`, assetHash };
    },
    async withManifestTransaction(options, fn) {
      manager.transactions.push(options);
      return fn();
    },
    getStats() {
      return { queuedDownloads: 0, activeDownloads: 0, currentBudget: { usedBytes: 0, maxAutomaticBytes: 64 * 1024 * 1024 } };
    },
  };
  return manager;
}

test('empty cache + 601 games with remote cover candidates queues all unique covers', async () => {
  const manager = makeManager();
  const service = new ColdCoverBootstrapService({ artworkDownloadManager: manager });
  const games = Array.from({ length: 601 }, (_, i) => makeGame(`game-${i}`));
  service.start(games, { reason: 'test-cold' });
  await service.whenIdle();
  const stats = service.getStats();
  assert.equal(stats.totalGames, 601);
  assert.equal(stats.uniqueJobs, 601);
  assert.equal(stats.queuedUniqueDownloads, 601);
  assert.equal(manager.requests.length, 601);
  assert.equal(stats.completedDownloads, 601);
});

test('initial visible priority does not prevent far games from eventually running', async () => {
  const manager = makeManager();
  const service = new ColdCoverBootstrapService({ artworkDownloadManager: manager, yieldEvery: 5 });
  const games = Array.from({ length: 30 }, (_, i) => makeGame(`far-${i}`));
  service.start(games);
  await service.whenIdle();
  assert.deepEqual(manager.requests.map(r => r.canonicalGameId).sort(), games.map(g => g.id).sort());
});

test('existing alias hits are skipped', async () => {
  const manager = makeManager({ existing: ['hit-1', 'hit-2'] });
  const service = new ColdCoverBootstrapService({ artworkDownloadManager: manager });
  service.start([makeGame('hit-1'), makeGame('hit-2'), makeGame('miss-1')]);
  await service.whenIdle();
  assert.equal(service.getStats().skippedExistingHits, 2);
  assert.deepEqual(manager.requests.map(r => r.canonicalGameId), ['miss-1']);
});

test('navigation away does not cancel the library bootstrap', async () => {
  const manager = makeManager({ slow: true });
  const service = new ColdCoverBootstrapService({ artworkDownloadManager: manager });
  service.start([makeGame('a'), makeGame('b'), makeGame('c')]);
  assert.equal(service.getStats().running, true);
  await service.whenIdle();
  assert.equal(service.getStats().completedDownloads, 3);
});

test('restart resumes only remaining misses', async () => {
  const manager = makeManager({ existing: ['done-a', 'done-b'] });
  const service = new ColdCoverBootstrapService({ artworkDownloadManager: manager });
  service.start([makeGame('done-a'), makeGame('done-b'), makeGame('todo-c')]);
  await service.whenIdle();
  assert.deepEqual(manager.requests.map(r => r.canonicalGameId), ['todo-c']);
});

test('batch completion does not emit one notification per cover', async () => {
  const manager = makeManager();
  const notifications = [];
  const service = new ColdCoverBootstrapService({
    artworkDownloadManager: manager,
    notify: payload => notifications.push(payload),
  });
  service.start(Array.from({ length: 40 }, (_, i) => makeGame(`notify-${i}`)));
  await service.whenIdle();
  assert.ok(notifications.length > 0);
  assert.ok(notifications.length < 40);
  assert.equal(service.getStats().perCoverEvents, 0);
});

test('no duplicate canonical jobs', async () => {
  const manager = makeManager();
  const service = new ColdCoverBootstrapService({ artworkDownloadManager: manager });
  service.start([makeGame('dup'), makeGame('dup'), makeGame('other')]);
  await service.whenIdle();
  assert.equal(service.getStats().duplicateJobs, 1);
  assert.deepEqual(manager.requests.map(r => r.canonicalGameId).sort(), ['dup', 'other']);
});

test('terminal failures do not loop', async () => {
  const manager = makeManager({ fail: new Map([['bad', 'capacity_exhausted']]) });
  const service = new ColdCoverBootstrapService({ artworkDownloadManager: manager });
  service.start([makeGame('bad')]);
  await service.whenIdle();
  assert.equal(manager.requests.length, 1);
  assert.equal(service.getStats().terminalFailuresByReason.capacity_exhausted, 1);
});

test('transient poster failures retry with a bound and recover', async () => {
  let requests = 0;
  const manager = makeManager();
  const original = manager.requestAsset;
  manager.requestAsset = async args => {
    requests += 1;
    if (requests === 1) return { status: 'failed', errorCode: 'HTTP_503' };
    return original(args);
  };
  const service = new ColdCoverBootstrapService({ artworkDownloadManager: manager, retryDelayMs: 1, maxRetries: 2 });
  service.start([makeGame('transient')]);
  await service.whenIdle();
  assert.equal(requests, 2);
  assert.equal(service.getStats().jobsByState.ready, 1);
});

test('permanent poster failures keep their actual cause and do not retry', async () => {
  let requests = 0;
  const manager = makeManager();
  manager.requestAsset = async () => {
    requests += 1;
    return { status: 'failed', errorCode: 'HTTP_404' };
  };
  const service = new ColdCoverBootstrapService({ artworkDownloadManager: manager, retryDelayMs: 1, maxRetries: 2 });
  service.start([makeGame('permanent')]);
  await service.whenIdle();
  const job = [...service._jobs.values()][0];
  assert.equal(requests, 1);
  assert.equal(job.state, 'terminal_error');
  assert.equal(job.lastError, 'HTTP_404');
  assert.deepEqual(job.candidateErrors.map(item => item.reason), ['HTTP_404']);
});

test('a viewport boost immediately revives a poster deferred by the automatic budget', async () => {
  let allowed = false;
  let requests = 0;
  const manager = makeManager();
  const original = manager.requestAsset;
  manager.requestAsset = async args => {
    requests += 1;
    if (!allowed) return {
      status: 'blocked',
      blockedReason: 'automatic-artwork-bandwidth-budget-exhausted',
      budgetRejection: true,
    };
    return original(args);
  };
  const game = makeGame('budget-deferred');
  const service = new ColdCoverBootstrapService({ artworkDownloadManager: manager });
  service.start([game]);
  await service.whenIdle();
  allowed = true;
  service.boost([game], { priority: 'visible' });
  await service.whenIdle();
  assert.equal(requests, 2);
  assert.equal(service.getStats().jobsByState.ready, 1);
});

test('sync completion does not wait for bootstrap', async () => {
  const manager = makeManager({ slow: true });
  const service = new ColdCoverBootstrapService({ artworkDownloadManager: manager });
  const started = Date.now();
  const result = service.start([makeGame('slow-a'), makeGame('slow-b')]);
  assert.equal(result.status, 'started');
  assert.ok(Date.now() - started < 25);
  await service.whenIdle();
});

test('main/renderer work is yielded and uses manifest batch transactions', async () => {
  const manager = makeManager();
  const service = new ColdCoverBootstrapService({ artworkDownloadManager: manager, batchSize: 50, yieldEvery: 10 });
  service.start(Array.from({ length: 55 }, (_, i) => makeGame(`yield-${i}`)));
  await service.whenIdle();
  assert.equal(manager.transactions[0].label, 'cold-library-cover-bootstrap');
  assert.equal(manager.transactions[0].batchSize, 50);
});


function makeConcurrentManager({ delayMs = 25 } = {}) {
  let active = 0;
  let maxActive = 0;
  const physicalDownloads = new Map();
  const requests = [];
  const aliases = new Map();
  const candidateOrder = new Map();
  const manager = {
    requests,
    physicalDownloads,
    get maxActive() { return maxActive; },
    getCachedAsset({ canonicalGameId, type }) {
      return aliases.get(`${canonicalGameId}|${type}`) || null;
    },
    linkCachedAlias({ assetHash, canonicalGameId, type }) {
      aliases.set(`${canonicalGameId}|${type}`, { fileUrl: `file:///cache/${assetHash}.webp`, assetHash });
      return aliases.get(`${canonicalGameId}|${type}`);
    },
    async requestAsset({ sourceUrl, canonicalGameId, type, priority, reason, sourceSubsystem }) {
      requests.push({ sourceUrl, canonicalGameId, type, priority, reason, sourceSubsystem });
      const order = candidateOrder.get(canonicalGameId) || [];
      order.push(sourceUrl);
      candidateOrder.set(canonicalGameId, order);
      if (sourceUrl.includes('/bad-')) return { status: 'failed', localUrl: null, errorCode: 'http_404' };
      if (!physicalDownloads.has(sourceUrl)) {
        physicalDownloads.set(sourceUrl, (async () => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise(resolve => setTimeout(resolve, delayMs));
          active -= 1;
          return `asset-${physicalDownloads.size}`;
        })());
      }
      const assetHash = await physicalDownloads.get(sourceUrl);
      aliases.set(`${canonicalGameId}|${type}`, { fileUrl: `file:///cache/${assetHash}.webp`, assetHash });
      return { status: 'downloaded', localUrl: `file:///cache/${assetHash}.webp`, assetHash };
    },
    async withManifestTransaction(_options, fn) { return fn(); },
    getStats() { return { queuedDownloads: 0, activeDownloads: active, currentBudget: null }; },
  };
  manager.candidateOrder = candidateOrder;
  return manager;
}

test('bounded worker pool saturates manager without exceeding configured concurrency', async () => {
  const manager = makeConcurrentManager({ delayMs: 20 });
  const service = new ColdCoverBootstrapService({ artworkDownloadManager: manager, jobConcurrency: 4 });
  service.start(Array.from({ length: 20 }, (_, i) => makeGame(`parallel-${i}`)));
  await service.whenIdle();
  assert.ok(manager.maxActive > 1, `expected parallel work, saw ${manager.maxActive}`);
  assert.ok(manager.maxActive <= 4, `expected bounded concurrency, saw ${manager.maxActive}`);
  assert.equal(new Set(manager.requests.map(r => r.canonicalGameId)).size, 20);
  assert.equal(service.getStats().completedDownloads, 20);
});

test('background concurrency is capped while visible work can use the foreground capacity', async () => {
  const backgroundManager = makeConcurrentManager({ delayMs: 20 });
  const background = new ColdCoverBootstrapService({
    artworkDownloadManager: backgroundManager,
    jobConcurrency: 6,
    backgroundJobConcurrency: 2,
  });
  background.start(Array.from({ length: 12 }, (_, i) => makeGame(`background-${i}`)));
  await background.whenIdle();
  assert.ok(backgroundManager.maxActive <= 2, `background work used ${backgroundManager.maxActive} slots`);

  const visibleManager = makeConcurrentManager({ delayMs: 20 });
  const visible = new ColdCoverBootstrapService({
    artworkDownloadManager: visibleManager,
    jobConcurrency: 6,
    backgroundJobConcurrency: 2,
  });
  const games = Array.from({ length: 12 }, (_, i) => makeGame(`visible-${i}`));
  visible.start(games);
  visible.boost(games.slice(0, 6), { priority: 'visible', reason: 'user-visible' });
  await visible.whenIdle();
  assert.ok(visibleManager.maxActive > 2, 'visible work must not be held to the background cap');
  assert.ok(visibleManager.maxActive <= 6);
});

test('bounded worker pool preserves URL dedupe and per-game candidate fallback order', async () => {
  const manager = makeConcurrentManager({ delayMs: 10 });
  const service = new ColdCoverBootstrapService({ artworkDownloadManager: manager, jobConcurrency: 3 });
  service.start([
    makeGame('fallback-a', null, { coverCandidates: ['https://cdn.example.test/bad-a.jpg', 'https://cdn.example.test/shared.jpg'] }),
    makeGame('fallback-b', null, { coverCandidates: ['https://cdn.example.test/shared.jpg'] }),
    makeGame('fallback-c', null, { coverCandidates: ['https://cdn.example.test/c.jpg'] }),
  ]);
  await service.whenIdle();
  assert.deepEqual(manager.candidateOrder.get('fallback-a'), [
    'https://cdn.example.test/bad-a.jpg',
    'https://cdn.example.test/shared.jpg',
  ]);
  assert.equal([...manager.physicalDownloads.keys()].filter(url => url === 'https://cdn.example.test/shared.jpg').length, 1);
  assert.equal(service.getStats().completedDownloads, 3);
});

test('synthetic 600-cover cold sync follows bounded parallel timing', async () => {
  const manager = makeConcurrentManager({ delayMs: 5 });
  const service = new ColdCoverBootstrapService({ artworkDownloadManager: manager, jobConcurrency: 6 });
  const games = Array.from({ length: 600 }, (_, i) => makeGame(`perf-${i}`));
  const started = Date.now();
  service.start(games);
  await service.whenIdle();
  const elapsed = Date.now() - started;
  assert.ok(manager.maxActive >= 4, `expected at least four active downloads, saw ${manager.maxActive}`);
  assert.ok(manager.maxActive <= 6, `expected bounded manager concurrency, saw ${manager.maxActive}`);
  assert.ok(elapsed < 600 * 5, `expected faster-than-sequential timing, got ${elapsed}ms`);
  assert.equal(manager.requests.filter(r => r.sourceSubsystem === 'renderer-cache-image-ipc').length, 0);
  assert.equal(new Set(manager.requests.map(r => r.sourceUrl)).size, 600);
});
test('viewport boost can enqueue a not-yet-started job with visible priority', async () => {
  const manager = makeConcurrentManager({ delayMs: 35 });
  const service = new ColdCoverBootstrapService({ artworkDownloadManager: manager, jobConcurrency: 1 });
  const games = Array.from({ length: 8 }, (_, i) => makeGame('viewport-' + i));

  service.start(games, { reason: 'background-cold-start' });
  service.boost([games[7]], { concurrency: 1, reason: 'viewport-visible' });
  await service.whenIdle();

  const boosted = manager.requests.find(r => r.canonicalGameId === 'viewport-7' && r.reason === 'viewport-visible');
  assert.ok(boosted, 'expected a visible boost request for the far viewport job');
  assert.equal(boosted.priority, 'visible');
  assert.equal(manager.requests.at(-1).canonicalGameId === 'viewport-7', false);
});

test('obsolete bootstrap generation cannot clear newer run state', async () => {
  const manager = makeConcurrentManager({ delayMs: 30 });
  const service = new ColdCoverBootstrapService({ artworkDownloadManager: manager, jobConcurrency: 1 });

  service.start([makeGame('old-a'), makeGame('old-b')], { reason: 'old-run' });
  const oldRun = service.whenIdle();
  service.start([makeGame('new-a')], { reason: 'new-run' });
  const newRun = service.whenIdle();

  await newRun;
  await oldRun;

  const stats = service.getStats();
  assert.equal(stats.running, false);
  assert.equal(stats.totalGames, 1);
  assert.equal(stats.uniqueJobs, 1);
  assert.equal(stats.lastError, null);
  assert.deepEqual(manager.requests.filter(r => r.reason === 'new-run').map(r => r.canonicalGameId), ['new-a']);
});

test('zero-candidate games wait for metadata instead of becoming no-source immediately', async () => {
  const manager = makeManager();
  const service = new ColdCoverBootstrapService({ artworkDownloadManager: manager });

  service.start([makeGame('epic-zero', null, { platform: 'epic', coverCandidates: [] })]);
  await service.whenIdle();

  const stats = service.getStats();
  assert.equal(stats.awaitingMetadata, 1);
  assert.equal(stats.genuineNoSourceGames, 1);
  assert.equal(stats.terminalFailuresByReason.metadata_unavailable, 1);
  assert.equal(manager.requests.length, 0);
});

test('visible boost resolves metadata for a zero-candidate Epic game before downloading', async () => {
  const manager = makeManager();
  const metadataCalls = [];
  const service = new ColdCoverBootstrapService({
    artworkDownloadManager: manager,
    metadataResolver: async (game) => {
      metadataCalls.push(game.id);
      return { cover: 'https://cdn.example.test/metadata-cover.jpg' };
    },
  });
  const game = makeGame('steam-visible', null, { platform: 'epic', coverCandidates: [] });

  service.start([game]);
  service.boost([game], { priority: 'visible', reason: 'viewport-visible' });
  await service.whenIdle();

  assert.deepEqual(metadataCalls, ['steam-visible']);
  assert.equal(manager.requests.length, 1);
  assert.equal(manager.requests[0].sourceUrl, 'https://cdn.example.test/metadata-cover.jpg');
  assert.equal(manager.requests[0].priority, 'visible');
  assert.equal(manager.requests[0].reason, 'viewport-visible');
  assert.equal(service.getStats().jobsByState.ready, 1);
});

test('metadata exhaustion is the authoritative no-source terminal state', async () => {
  const manager = makeManager();
  const service = new ColdCoverBootstrapService({
    artworkDownloadManager: manager,
    metadataResolver: async () => ({ description: 'no artwork here' }),
  });

  service.start([makeGame('no-source-after-metadata', null, { coverCandidates: [] })]);
  await service.whenIdle();

  const stats = service.getStats();
  assert.equal(stats.metadataRequests, 1);
  assert.equal(stats.metadataNoSource, 1);
  assert.equal(stats.jobsByState.terminal_no_source, 1);
  assert.equal(manager.requests.length, 0);
});
