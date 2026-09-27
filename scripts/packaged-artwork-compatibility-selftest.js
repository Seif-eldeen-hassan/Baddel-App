const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');

(async () => {
  const root = process.cwd();
  const outDir = path.join(root, 'acceptance-checkpoints', 'packaged-compatibility');
  fs.mkdirSync(outDir, { recursive: true });
  const asarRoot = path.join(root, 'dist', 'win-unpacked', 'resources', 'app.asar');
  const { ArtworkDownloadManager } = require(path.join(asarRoot, 'src', 'features', 'games', 'infrastructure', 'services', 'ArtworkDownloadManager.js'));
  const sharp = require(path.join(asarRoot, 'node_modules', 'sharp'));

  const width = 1600;
  const height = 2400;
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 3;
      raw[i] = (x * 255 / width) & 255;
      raw[i + 1] = (y * 255 / height) & 255;
      raw[i + 2] = ((x ^ y) & 255);
    }
  }
  const source = await sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 92 }).toBuffer();
  const manager = new ArtworkDownloadManager({
    cache: { getManifest: () => ({ stats: {} }), getCapacityStats: () => ({}) },
    scheduler: { getStats: () => ({}), getSnapshot: () => ({ stats: {}, active: 0, pending: [] }) },
    httpClient: {},
    logger: { log() {}, warn() {}, error() {} },
  });
  const normalized = await manager._normalizeCoverBuffer({ buffer: source, mime: 'image/jpeg' });
  const meta = await sharp(normalized.buffer).metadata();
  const outFile = path.join(outDir, `packaged-synthetic-cover-${Date.now()}.webp`);
  fs.writeFileSync(outFile, normalized.buffer);
  const result = {
    marker: 'PACKAGED_ARTWORK_COMPATIBILITY',
    phase: 'node-normalizer',
    packagedAsar: asarRoot,
    sharpLoaded: true,
    sharpVersion: sharp.versions?.sharp || null,
    source: { width, height, bytes: source.length, mime: 'image/jpeg' },
    output: { file: outFile, fileUrl: pathToFileURL(outFile).toString(), bytes: normalized.buffer.length, mime: normalized.mime, width: meta.width, height: meta.height, format: meta.format, normalized: normalized.normalized === true, originalBytes: normalized.originalBytes },
    boundsOk: meta.width <= 384 && meta.height <= 576,
    webpOk: meta.format === 'webp' && normalized.mime === 'image/webp',
    sizeOk: normalized.buffer.length <= 500 * 1024,
  };
  fs.writeFileSync(path.join(outDir, 'packaged-artwork-compatibility-node.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
})().catch((err) => {
  console.error(JSON.stringify({ marker: 'PACKAGED_ARTWORK_COMPATIBILITY', status: 'error', code: err.code || 'SELFTEST_FAILED', message: err.message, stack: err.stack }, null, 2));
  process.exit(1);
});
