const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');

const candidates = [
  path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Baddel Launcher Beta'),
  path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'baddel-launcher-beta'),
  path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'BaddelLauncher'),
];
const userData = candidates.find((p) => fs.existsSync(p)) || candidates[0];
const now = new Date().toISOString().replace(/[:.]/g, '-');
const backupRoot = path.join(process.cwd(), 'acceptance-checkpoints', `artwork-${now}`);
fs.mkdirSync(backupRoot, { recursive: true });

const files = [
  path.join(userData, 'artwork-cache-v2', 'manifest.json'),
  path.join(userData, 'artwork-cache-v2', 'manifest.backup.json'),
  path.join(userData, 'platform-sync', 'steam_library_merged.json'),
  path.join(userData, 'platform-sync', 'epic_library_merged.json'),
  path.join(userData, 'platform-sync', 'gog_library_merged.json'),
];
function hashFile(file) {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(file));
  return h.digest('hex');
}
const entries = [];
for (const file of files) {
  const rel = path.relative(userData, file);
  const dest = path.join(backupRoot, rel);
  if (fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(file, dest);
    const stat = fs.statSync(file);
    entries.push({ source: file, backup: dest, exists: true, bytes: stat.size, mtimeMs: stat.mtimeMs, sha256: hashFile(file) });
  } else {
    entries.push({ source: file, backup: dest, exists: false });
  }
}
const meta = {
  createdAt: new Date().toISOString(),
  userData,
  backupRoot,
  note: 'Pre-acceptance checkpoint before real artwork cache migration. Restore by copying existing=true backup files back to source paths while app is closed.',
  migrationResume: {
    strategy: 'ContentAddressedArtworkCache.migrateOneOversizedActiveCover is one-asset-at-a-time and idempotent; manifest aliases are repointed only after normalized replacement write succeeds.',
    rollback: 'Use sha256/source/backup entries below. No custom/user artwork is included or modified.',
  },
  files: entries,
};
fs.writeFileSync(path.join(backupRoot, 'checkpoint.json'), JSON.stringify(meta, null, 2));
console.log(JSON.stringify(meta, null, 2));
