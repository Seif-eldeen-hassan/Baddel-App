'use strict';

// System-related IPC handlers extracted from main.js.
// All behaviour is verbatim — only outer-scope references are threaded through deps.
//
// deps shape:
//   { app, os, path, fs, shell,
//     driveCache, refreshDriveCache,
//     readStartupPrefs, writeStartupPrefs, getStartupLoginItemOptions, applyStartupSetting }

// systeminformation is optional — same lazy-load pattern as main.js.
let si;
try { si = require('systeminformation'); } catch {
    si = null;
}

// Populated by get-system-info, consumed by get-live-stats (mirrors staticGpuInfo in main.js).
let staticGpuInfo = null;

module.exports.register = function registerSystemHandlers(ipcMain, deps) {
    const {
        app, os, path, fs, shell,
        driveCache, refreshDriveCache,
        readStartupPrefs, writeStartupPrefs, getStartupLoginItemOptions, applyStartupSetting,
    } = deps;

    // ---- System: desktop path ----
    ipcMain.handle('get-desktop-path', () => app.getPath('desktop'));

    // ---- System: drives list ----
    ipcMain.handle('get-drives', async () => {
        const nativeFs = require('fs');
        const pathMod  = require('path');
        const osLocal  = require('os');
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsyncLocal = promisify(exec);

        function iconSvg(color = '#0a84ff', type = 'folder') {
            if (type === 'drive') {
                return `
                <svg viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="4" width="18" height="14" rx="2"/>
                    <path d="M7 20h10"/>
                    <path d="M12 18v2"/>
                </svg>
            `;
            }

            return `
            <svg viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 7h6l2 2h10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
            </svg>
        `;
        }

        function pushUnique(list, item) {
            if (!item?.path) return;

            const key = String(item.path).replace(/[\\/]+$/, '').toLowerCase();
            const exists = list.some(x =>
                String(x.path || '').replace(/[\\/]+$/, '').toLowerCase() === key
            );

            if (!exists) list.push(item);
        }

        function safeSpecialFolder(key, label, color, fallbackFolderName = null) {
            let p = null;

            try {
                p = app.getPath(key);
            } catch (e) {
                console.warn(`[get-drives] app.getPath("${key}") failed:`, e.message);
            }

            // fallback زي C:\Users\User\Documents لو app.getPath('documents') وقع
            if (!p && fallbackFolderName) {
                try {
                    const fallback = pathMod.join(osLocal.homedir(), fallbackFolderName);
                    if (nativeFs.existsSync(fallback)) p = fallback;
                } catch {}
            }

            if (!p) return null;

            return {
                path: p,
                label,
                icon: iconSvg(color, 'folder'),
                isQuick: true
            };
        }

        async function getWindowsDrivesFallback() {
            try {
                const ps = 'powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_LogicalDisk | Where-Object { $_.DriveType -in 2,3,5 } | Select-Object DeviceID,VolumeName,DriveType | ConvertTo-Json -Compress"';

                const { stdout } = await execAsyncLocal(ps, {
                    windowsHide: true,
                    timeout: 8000
                });

                if (!stdout || !stdout.trim()) return [];

                const parsed = JSON.parse(stdout.trim());
                const rows = Array.isArray(parsed) ? parsed : [parsed];

                return rows
                    .filter(d => d?.DeviceID)
                    .map(d => {
                        const root = `${String(d.DeviceID).replace(/\\$/, '')}\\`;
                        const volumeName = String(d.VolumeName || '').trim();

                        return {
                            path: root,

                            label: volumeName || (root.toUpperCase().startsWith('C:') ? 'Local Disk' : 'Drive'),

                            icon: iconSvg('#8e8e93', 'drive'),
                            isQuick: false
                        };
                    });

            } catch (e) {
                console.warn('[get-drives] Windows drives fallback failed:', e.message);
                return [];
            }
        }

        try {
            const result = [];

            // Quick folders
            const quickFolders = [
                safeSpecialFolder('desktop',   'Desktop',   '#0a84ff', 'Desktop'),
                safeSpecialFolder('downloads', 'Downloads', '#30d158', 'Downloads'),
                safeSpecialFolder('documents', 'Documents', '#bf5af2', 'Documents'),
                safeSpecialFolder('pictures',  'Pictures',  '#ffd60a', 'Pictures'),
                safeSpecialFolder('videos',    'Videos',    '#ff453a', 'Videos'),
                safeSpecialFolder('music',     'Music',     '#64d2ff', 'Music'),
            ];

            for (const q of quickFolders) {
                if (q) pushUnique(result, q);
            }

            // Try your existing drive cache
            try {
                await Promise.resolve(refreshDriveCache());
            } catch (e) {
                console.warn('[get-drives] refreshDriveCache failed:', e.message);
            }

            const cachedDrives = Array.isArray(driveCache?.data)
                ? driveCache.data
                : [];

            for (const d of cachedDrives) {
                if (!d?.path) continue;

                pushUnique(result, {
                    path: d.path,

                    label: String(d.label || '').replace(/\s*\([A-Z]:\\?\)\s*$/i, '') || 'Drive',

                    icon: d.icon || iconSvg('#8e8e93', 'drive'),
                    isQuick: false
                });
            }

            // PowerShell fallback for all Windows partitions
            const windowsDrives = await getWindowsDrivesFallback();

            for (const d of windowsDrives) {
                pushUnique(result, d);
            }

            // Last fallback
            if (!result.length) {
                console.warn('[get-drives] returning final C:\\ fallback');

                return [{
                    path: 'C:\\',
                    label: 'Local Disk',
                    icon: iconSvg('#8e8e93', 'drive'),
                    isQuick: false
                }];
            }

            return result;

        } catch (e) {
            console.warn('[get-drives] fatal fallback:', e.message);

            return [{
                path: 'C:\\',
                label: 'Local Disk',
                icon: iconSvg('#8e8e93', 'drive'),
                isQuick: false
            }];
        }
    });

    // ---- System: directory listing ----
    ipcMain.handle('list-directories', async (_, targetPath) => {
        if (!targetPath) return [];
        let cleanPath = path.normalize(targetPath);
        if (cleanPath.length === 2 && cleanPath.endsWith(':')) cleanPath += path.sep;

        const ALLOWED_EXTS = new Set(['.exe', '.lnk', '.url']); // .bat removed — shell-script risk
        const FORBIDDEN_DIRS = new Set(['$recycle.bin', 'system volume information', 'recovery', 'windows', 'boot']);

        const readFolder = async (folderPath) => {
            try {
                const entries = await fs.readdir(folderPath, { withFileTypes: true });
                const results = await Promise.all(entries.map(async (entry) => {
                    const fullPath = path.join(folderPath, entry.name);
                    if (entry.isDirectory()) {
                        const lower = entry.name.toLowerCase();
                        if (!FORBIDDEN_DIRS.has(lower) && !entry.name.startsWith('.')) {
                            return { name: entry.name, type: 'dir' };
                        }
                    } else if (entry.isFile()) {
                        const ext = path.extname(entry.name).toLowerCase();
                        if (ALLOWED_EXTS.has(ext)) {
                            let iconPath = fullPath;
                            if (ext === '.lnk') {
                                try {
                                    const shortcut = shell.readShortcutLink(fullPath);
                                    if (shortcut.target) iconPath = shortcut.target;
                                } catch { /* ignore */ }
                            }
                            try {
                                const icon = await Promise.race([
                                    app.getFileIcon(iconPath, { size: 'normal' }),
                                    new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 300))
                                ]);
                                const iconData = (icon && !icon.isEmpty()) ? icon.toDataURL() : null;
                                return { name: entry.name, type: 'file', path: fullPath, icon: iconData };
                            } catch {
                                return { name: entry.name, type: 'file', path: fullPath, icon: null };
                            }
                        }
                    }
                    return null;
                }));
                return results.filter(Boolean);
            } catch {
                return [];
            }
        };

        let results = await readFolder(cleanPath);

        if (cleanPath.toLowerCase() === app.getPath('desktop').toLowerCase()) {
            const publicDesktop = path.join(process.env.PUBLIC || 'C:\\Users\\Public', 'Desktop');
            const publicItems = await readFolder(publicDesktop);
            const existing = new Set(results.map(r => r.name.toLowerCase()));
            publicItems.forEach(item => { if (!existing.has(item.name.toLowerCase())) results.push(item); });
        }

        return results.sort((a, b) =>
            a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1
        );
    });

    // ---- System: hardware info (slow — cached after first call) ----
    ipcMain.handle('get-system-info', async () => {
        const cpus = os.cpus();
        const base = {
            osName: `${os.type()} ${os.release()}`,
            cpuModel: cpus[0]?.model || '—',
            cpuCores: cpus.length,
            totalRam: os.totalmem(),
            ramSpeed: '—'
        };
        if (!si) return base;
        try {
            const [gpu, memLayout] = await Promise.all([si.graphics(), si.memLayout()]);
            const gpuList = gpu.controllers || [];
            staticGpuInfo = gpuList.find(g => g.vram > 0) || gpuList[0];
            base.gpuModel = staticGpuInfo?.model || '—';
            base.gpuVram = (staticGpuInfo?.vram || 0) * 1024 * 1024;
            if (memLayout?.length > 0) {
                base.ramSpeed = `${memLayout[0].clockSpeed || 0} MHz`;
                const sizeCounts = {};
                memLayout.forEach(stick => {
                    if (stick.size && stick.size > 0) {
                        const sizeGB = Math.round(stick.size / (1024 ** 3)); // تحويل البايت لجيجابايت
                        sizeCounts[sizeGB] = (sizeCounts[sizeGB] || 0) + 1;
                    }
                });

                const kitsStrs = Object.entries(sizeCounts).map(([size, count]) => `${count}x${size}GB`);
                base.ramKitsStr = kitsStrs.length > 0 ? kitsStrs.join(' + ') : '—';
            }
        } catch { /* hardware info optional */ }
        return base;
    });

    // ---- System: live stats ----
    ipcMain.handle('get-live-stats', async () => {
        if (!si) return {};
        try {
            const [cpu, mem, net, temp, ping] = await Promise.all([
                si.currentLoad(),
                si.mem(),
                si.networkStats(),
                si.cpuTemperature().catch(() => null),
                si.inetLatency('8.8.8.8').catch(() => 0)
            ]);
            return {
                cpuLoad: Math.round(cpu.currentLoad || 0),
                cpuTemp: temp?.main ? Math.round(temp.main) : null,
                usedRam: mem.active || mem.used,
                totalRam: mem.total,
                netRxBytes: net[0]?.rx_bytes || 0,
                netTxBytes: net[0]?.tx_bytes || 0,
                ping: Math.round(ping || 0),
                gpuLoad: staticGpuInfo?.utilizationGpu || 0,
                gpuTemp: staticGpuInfo?.temperatureGpu || 0
            };
        } catch { return {}; }
    });

    // ---- Startup toggle IPC ----
    ipcMain.handle('get-startup-enabled', () => {
        if (!app.isPackaged) return false;

        const prefs = readStartupPrefs();
        const opts  = getStartupLoginItemOptions();

        // OS state is the ground truth — query with same path/args used for set.
        let osEnabled = null;
        try { osEnabled = !!app.getLoginItemSettings(opts).openAtLogin; } catch {}

        if (osEnabled !== null) {
            const prefEnabled = prefs.userSetStartupEnabled === true ? !!prefs.startupEnabled : null;
            return { enabled: osEnabled, osEnabled, prefEnabled,
                     userSetStartupEnabled: prefs.userSetStartupEnabled === true,
                     source: 'os', path: opts.path };
        }

        // OS query unavailable — fall back to stored preference.
        if (prefs.userSetStartupEnabled === true) {
            return { enabled: !!prefs.startupEnabled, source: 'preference',
                     osEnabled: null, userSetStartupEnabled: true, path: opts.path };
        }
        return { enabled: true, source: 'default', osEnabled: null, userSetStartupEnabled: false, path: opts.path };
    });

    ipcMain.handle('set-startup-enabled', (_, enable) => {
        if (!app.isPackaged) return { status: 'dev', enabled: false, requestedEnabled: !!enable };

        const enabled = !!enable;
        const opts    = getStartupLoginItemOptions();
        console.log(`[Startup] set-startup-enabled: requested=${enabled} isPackaged=${app.isPackaged} path=${opts.path} args=${JSON.stringify(opts.args)}`);

        try {
            applyStartupSetting(enabled, 'user-toggle');
        } catch (err) {
            console.error('[Startup] setLoginItemSettings threw:', err?.message || err);
            return { status: 'error', enabled: false, requestedEnabled: enabled, osEnabled: null, path: opts.path };
        }

        // Verify what the OS committed — must use the same path/args identity.
        let osEnabled = null;
        try {
            osEnabled = !!app.getLoginItemSettings(opts).openAtLogin;
            console.log(`[Startup] set-startup-enabled: osEnabled=${osEnabled} requested=${enabled}`);
        } catch (err) {
            console.warn('[Startup] could not verify via getLoginItemSettings:', err?.message);
        }

        const verifiedEnabled = osEnabled !== null ? osEnabled : enabled;
        console.log(`[Startup] set-startup-enabled: verifiedEnabled=${verifiedEnabled}`);

        const prefs = readStartupPrefs();
        if (verifiedEnabled !== enabled) {
            console.warn(`[Startup] mismatch — requested=${enabled} verified=${verifiedEnabled}`);
            writeStartupPrefs({
                ...prefs,
                startupEnabled: verifiedEnabled,
                userSetStartupEnabled: true,
                startupVerified: verifiedEnabled,
                lastRequestedStartupEnabled: enabled,
                lastStartupStatus: 'mismatch',
                updatedAt: new Date().toISOString(),
            });
            return { status: 'mismatch', enabled: verifiedEnabled, requestedEnabled: enabled, osEnabled, path: opts.path };
        }

        writeStartupPrefs({
            ...prefs,
            startupEnabled: verifiedEnabled,
            userSetStartupEnabled: true,
            startupVerified: verifiedEnabled,
            lastRequestedStartupEnabled: enabled,
            lastStartupStatus: 'success',
            updatedAt: new Date().toISOString(),
        });
        return { status: 'success', enabled: verifiedEnabled, requestedEnabled: enabled, osEnabled, path: opts.path };
    });
};
