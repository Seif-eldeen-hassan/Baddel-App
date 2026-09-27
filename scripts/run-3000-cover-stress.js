const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');
const { ContentAddressedArtworkCache, ARTWORK_CACHE_CLASSES } = require('../src/features/games/infrastructure/services/ContentAddressedArtworkCache');

function percentile(values, p) { if (!values.length) return 0; const sorted = [...values].sort((a,b)=>a-b); return sorted[Math.min(sorted.length-1, Math.floor((sorted.length-1)*p))]; }
function pad(buffer, target, seed) { return buffer.length >= target ? buffer : Buffer.concat([buffer, Buffer.alloc(target - buffer.length, seed)]); }
async function makeWebp({ channels = 3, quality = 80, targetBytes = 100 * 1024, seed = 1 }) {
  const width = 384, height = 576;
  const raw = Buffer.alloc(width * height * channels);
  for (let i = 0; i < raw.length; i += channels) {
    const px = Math.floor(i / channels); const x = px % width; const y = Math.floor(px / width);
    raw[i] = (x * 17 + seed * 31 + y) & 255;
    raw[i + 1] = (y * 13 + seed * 19 + x) & 255;
    raw[i + 2] = ((x ^ y) + seed * 7) & 255;
    if (channels === 4) raw[i + 3] = ((x * 5 + y * 3 + seed) & 255);
  }
  return pad(await sharp(raw, { raw: { width, height, channels } }).webp({ quality }).toBuffer(), targetBytes, seed);
}
(async () => {
  const root = path.join(process.cwd(), 'acceptance-checkpoints', `stress-3000-${Date.now()}`);
  const baseDir = path.join(root, 'artwork-cache-v2');
  const cache = new ContentAddressedArtworkCache({ fs, path, crypto, baseDir, activeLibraryGameCount: 3000, activeCoverCacheBytes: 2 * 1024 * 1024 * 1024, secondaryCacheBytes: 1024, logger: { log(){}, warn(){}, error(){} } });
  const covers = [
    await makeWebp({ quality: 50, targetBytes: 100 * 1024, seed: 11 }),
    await makeWebp({ quality: 95, targetBytes: 200 * 1024, seed: 22 }),
    await makeWebp({ channels: 4, quality: 98, targetBytes: 460 * 1024, seed: 33 }),
  ];
  const sizes = [];
  const preflightSamples = [];
  const startedAt = Date.now();
  cache.beginManifestTransaction({ label: 'acceptance-3000-cover-hydration', batchSize: 50 });
  for (let i = 0; i < 3000; i += 1) {
    const buffer = covers[i % covers.length];
    sizes.push(buffer.length);
    if (i % 1000 === 0 || i === 2999) preflightSamples.push(cache.preflightStore({ type: 'cover', assetClass: ARTWORK_CACHE_CLASSES.ACTIVE_LIBRARY_COVER, estimatedBytes: buffer.length, activeLibraryGameCount: 3000 }));
    cache.storeBuffer({ sourceUrl: `https://stress.example/${i}.webp`, canonicalGameId: `stress:${i}`, type: 'cover', buffer, mime: 'image/webp', assetClass: ARTWORK_CACHE_CLASSES.ACTIVE_LIBRARY_COVER, variant: 'card-cover-384x576-webp', normalized: true, originalBytes: buffer.length });
  }
  cache.storeBuffer({ sourceUrl: 'https://stress.example/hero-a.webp', canonicalGameId: 'hero-a', type: 'hero', buffer: covers[2], mime: 'image/webp', assetClass: ARTWORK_CACHE_CLASSES.SECONDARY });
  cache.storeBuffer({ sourceUrl: 'https://stress.example/hero-b.webp', canonicalGameId: 'hero-b', type: 'hero', buffer: covers[1], mime: 'image/webp', assetClass: ARTWORK_CACHE_CLASSES.SECONDARY });
  cache.commitManifestTransaction({ final: true });
  const after = cache.getCapacityStats();
  const manifest = cache.getManifest();
  const reopened = new ContentAddressedArtworkCache({ fs, path, crypto, baseDir, activeLibraryGameCount: 3000, activeCoverCacheBytes: 2 * 1024 * 1024 * 1024, secondaryCacheBytes: 1024, logger: { log(){}, warn(){}, error(){} } });
  let resolved = 0;
  for (let i = 0; i < 3000; i += 1) if (reopened.lookupAlias({ canonicalGameId: `stress:${i}`, type: 'cover' })?.fileUrl) resolved += 1;
  const worstCaseProjectedBytes = 3000 * 500 * 1024;
  const report = {
    marker: 'BADDEL_3000_COVER_STRESS_VALIDATION',
    durationMs: Date.now() - startedAt,
    root,
    totalAliases: 3000,
    physicalRepresentativeAssets: covers.length,
    representativeSizes: { min: Math.min(...sizes), avg: Math.round(sizes.reduce((s,v)=>s+v,0)/sizes.length), p50: percentile(sizes,.5), p95: percentile(sizes,.95), max: Math.max(...sizes) },
    worstCaseCapacity: { activeGameCount: 3000, perCoverUpperBoundBytes: 500 * 1024, projectedBytes: worstCaseProjectedBytes, configuredAllowanceBytes: after.activeCoverCacheBytes, allowed: worstCaseProjectedBytes <= after.activeCoverCacheBytes },
    preflightSamples,
    capacity: after,
    aliasesResolvedAfterRestart: resolved,
    activeCoverEvictions: Number(manifest.stats?.evictionsByArtworkClass?.[ARTWORK_CACHE_CLASSES.ACTIVE_LIBRARY_COVER] || 0),
    evictionsByArtworkClass: manifest.stats?.evictionsByArtworkClass || {},
    capacityExhausted: Number(manifest.stats?.capacityExhausted || 0),
  };
  report.pass = report.aliasesResolvedAfterRestart === 3000 && report.activeCoverEvictions === 0 && report.worstCaseCapacity.allowed;
  fs.writeFileSync(path.join(process.cwd(), 'acceptance-checkpoints', 'stress-3000-cover-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
})().catch(err => { console.error(err.stack || err); process.exit(1); });
