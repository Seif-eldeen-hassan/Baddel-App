const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const checkpointRoot = 'E:\\Baddel\\Baddel-App\\acceptance-checkpoints\\artwork-2026-08-22T04-02-06-019Z';
const userData = 'C:\\Users\\TestUser\\AppData\\Roaming\\baddel-launcher-beta';
const srcDir = path.join(userData, 'artwork-cache-v2', 'assets');
const destDir = path.join(checkpointRoot, 'artwork-cache-v2', 'assets');
fs.mkdirSync(destDir, { recursive: true });

function sha256(file) {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (;;) {
      const bytes = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (!bytes) break;
      h.update(buffer.subarray(0, bytes));
    }
  } finally {
    fs.closeSync(fd);
  }
  return h.digest('hex');
}

const files = fs.existsSync(srcDir) ? fs.readdirSync(srcDir).filter((name) => fs.statSync(path.join(srcDir, name)).isFile()) : [];
let totalBytes = 0;
const entries = [];
for (const name of files) {
  const source = path.join(srcDir, name);
  const dest = path.join(destDir, name);
  fs.copyFileSync(source, dest);
  const stat = fs.statSync(source);
  totalBytes += stat.size;
  entries.push({ name, source, backup: dest, bytes: stat.size, mtimeMs: stat.mtimeMs, sha256: sha256(source) });
}
const out = {
  createdAt: new Date().toISOString(),
  sourceDir: srcDir,
  backupDir: destDir,
  fileCount: entries.length,
  totalBytes,
  note: 'Physical artwork asset checkpoint. Restore with app closed by copying these files back into artwork-cache-v2/assets together with checkpointed manifests.',
  files: entries,
};
fs.writeFileSync(path.join(checkpointRoot, 'artwork-cache-v2', 'assets.checkpoint.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify({ ...out, files: undefined }, null, 2));
