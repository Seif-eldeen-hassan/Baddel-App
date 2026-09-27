'use strict';
const fs = require('node:fs');
const path = require('node:path');
const [installPath, configPath, mode] = process.argv.slice(2);
fs.mkdirSync(installPath, { recursive: true });
const checkpoint = path.join(installPath, '.resume-fixture');
const resumed = fs.existsSync(checkpoint);
fs.writeFileSync(checkpoint, 'partial data retained');
if (mode === 'auth-failure') {
    process.stderr.write('[cli] ERROR: Login failed: invalid refresh_token=fixture-private-token\n');
    process.exitCode = 1;
} else {
    process.stderr.write(fs.readFileSync(path.join(__dirname, 'upstream-progress.txt'), 'utf8'));
    if (mode === 'hold') setInterval(() => {}, 1000);
    else setTimeout(() => {
        fs.mkdirSync(configPath, { recursive: true });
        fs.writeFileSync(path.join(installPath, 'TestGame.exe'), Buffer.alloc(128 * 1024));
        fs.writeFileSync(path.join(configPath, 'installed.json'), JSON.stringify({ TestApp: {
            app_name: 'TestApp', install_path: installPath, executable: 'TestGame.exe',
            version: resumed ? 'resumed-build' : 'new-build', needs_verification: false,
        } }));
        process.stderr.write('[DLManager] INFO: = Progress: 100.00% (20/20), ETA: 00:00:00\n');
        process.stderr.write('[DLManager] INFO:  - Downloaded: 0.06 MiB, Written: 0.12 MiB\n');
    }, 100);
}
