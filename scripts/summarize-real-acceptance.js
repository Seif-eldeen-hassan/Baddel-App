const fs = require('node:fs');
const path = require('node:path');
const root = path.join(process.cwd(), 'acceptance-checkpoints');
function read(name) { try { return JSON.parse(fs.readFileSync(path.join(root, name), 'utf8')); } catch (err) { return { missing: true, error: err.message }; } }
function lastSnapshot(audit) { return Array.isArray(audit.snapshots) ? audit.snapshots[audit.snapshots.length - 1] : audit; }
function snapSummary(name, auditName, statsName) {
  const audit = read(auditName);
  const statsWrap = read(statsName);
  const snap = lastSnapshot(audit) || {};
  const stats = statsWrap.stats || statsWrap || {};
  const cats = snap.fullLibraryAudit?.categories || {};
  const capacity = stats.capacity || snap.cacheCapacity || {};
  const byClass = capacity.byClass || {};
  return {
    name,
    auditFile: auditName,
    statsFile: statsName,
    status: snap.status || audit.status || null,
    totalGames: snap.fullLibraryAudit?.totalGames ?? null,
    validAliasHit: cats.valid_alias_hit || 0,
    storedFileUrlExists: cats.stored_file_url_exists || 0,
    storedFileUrlMissing: cats.stored_file_url_missing || 0,
    aliasPointsToMissingFile: cats.alias_points_to_missing_file || 0,
    remoteCandidateOnly: cats.remote_candidate_only || 0,
    noArtworkSource: cats.no_artwork_source || 0,
    identityMismatch: cats.identity_mismatch || 0,
    rendererAssignedEvictedOrDeleted: snap.rendererEvidence?.assignedUrlWhoseFileWasEvictedOrDeleted || 0,
    rendererValidFileChromiumFailed: snap.rendererEvidence?.validFileChromiumFailedToLoad || 0,
    imgErrorCount: snap.rendererEvidence?.imgErrorCount || 0,
    activeDownloads: stats.activeDownloads ?? null,
    queuedDownloads: stats.queuedDownloads ?? null,
    downloadedBytes: stats.downloadedBytes ?? null,
    cacheHits: stats.cacheHits ?? null,
    cacheMisses: stats.cacheMisses ?? null,
    capacityExhausted: stats.capacityExhausted ?? stats.cache?.capacityExhausted ?? 0,
    validationFailures: stats.ipcValidationFailures ?? 0,
    terminalErrorCount: stats.terminalErrorCount ?? 0,
    evictionsByArtworkClass: stats.cache?.evictionsByArtworkClass || snap.cacheCapacity?.evictionsByArtworkClass || {},
    capacity: {
      globalMaxBytes: capacity.maxCacheBytes || snap.cacheCapacity?.effectiveMaxCacheBytes || null,
      activeCoverAllowanceBytes: capacity.activeCoverCacheBytes || null,
      secondaryAllowanceBytes: capacity.secondaryCacheBytes || null,
      byClass,
      totalBytes: capacity.totalBytes || null,
      physicalBytes: snap.cacheCapacity?.actualPhysicalBytes || null,
    },
  };
}
const summaries = [
  snapSummary('post-migration', 'post-migration-artwork-audit.json', 'post-migration-artwork-stats.json'),
  snapSummary('post-hydration', 'post-hydration-artwork-audit.json', 'post-hydration-artwork-stats.json'),
  snapSummary('post-restart', 'post-restart-artwork-audit.json', 'post-restart-artwork-stats.json'),
  snapSummary('post-scroll', 'post-scroll-artwork-audit.json', 'post-scroll-artwork-stats.json'),
];
const hydration = read('post-hydration-run.json');
const scroll = read('post-scroll-run.json');
function delta(before = {}, after = {}, key) { return Number(after[key] || 0) - Number(before[key] || 0); }
const report = {
  marker: 'BADDEL_REAL_601_ACCEPTANCE_RESULTS_PRESERVED',
  generatedAt: new Date().toISOString(),
  appAsarStatus: 'local-acceptance-only-current-build-contains-acceptance-checkpoints',
  summaries,
  hydrationDelta: {
    durationMs: hydration.durationMs || null,
    startDownloadedBytes: hydration.start?.downloadedBytes ?? null,
    endDownloadedBytes: hydration.end?.stats?.downloadedBytes ?? null,
    downloadedBytesDuringHydration: delta(hydration.start, hydration.end?.stats, 'downloadedBytes'),
    cacheHitsDuringHydration: delta(hydration.start, hydration.end?.stats, 'cacheHits'),
    cacheMissesDuringHydration: delta(hydration.start, hydration.end?.stats, 'cacheMisses'),
    readyArtworkCount: hydration.end?.readyArtworkCount ?? null,
    totalGames: hydration.end?.totalGames ?? null,
    idle: hydration.end ? hydration.end.active === 0 && hydration.end.queued === 0 && hydration.end.jobs === 0 : null,
  },
  scrollDelta: {
    durationMs: scroll.durationMs || null,
    downloadedBytesDuringScroll: delta(scroll.before, scroll.after, 'downloadedBytes'),
    cacheHitsDuringScroll: delta(scroll.before, scroll.after, 'cacheHits'),
    cacheMissesDuringScroll: delta(scroll.before, scroll.after, 'cacheMisses'),
    activeDownloadsAfterScroll: scroll.after?.activeDownloads ?? null,
    queuedDownloadsAfterScroll: scroll.after?.queuedDownloads ?? null,
  },
};
fs.writeFileSync(path.join(root, 'real-601-acceptance-summary-preserved.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
