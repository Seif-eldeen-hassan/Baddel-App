const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = process.cwd();
const exe = path.join(root, 'dist', 'win-unpacked', 'Baddel Launcher Beta.exe');
const stdoutPath = path.join(root, 'acceptance-packaged-stdout.log');
const stderrPath = path.join(root, 'acceptance-packaged-stderr.log');
const stdout = fs.openSync(stdoutPath, 'a');
const stderr = fs.openSync(stderrPath, 'a');
const child = spawn(exe, [], {
  cwd: root,
  detached: true,
  windowsHide: false,
  stdio: ['ignore', stdout, stderr],
  env: {
    ...process.env,
    BADDEL_QUIET_LOGS: '1',
    BADDEL_DISABLE_STARTUP_SYNC: '1',
    BADDEL_ENABLE_ARTWORK_PERSISTENCE_AUDIT: '1',
    BADDEL_ENABLE_DEVTOOLS: '1',
    BADDEL_SCROLL_DIAG_PORT: '9224',
  },
});
child.unref();
console.log(JSON.stringify({ ok: true, pid: child.pid, exe, stdoutPath, stderrPath, port: 9224 }, null, 2));
setTimeout(() => { try { fs.closeSync(stdout); } catch {} try { fs.closeSync(stderr); } catch {} }, 250).unref();
