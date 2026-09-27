'use strict';

// ============================================================
// LAUNCHER PATH RESOLVER
// Generic launcher detection for the Account Switcher.
// Supports: Steam, Epic Games Launcher, GOG Galaxy, EA App, Riot Client,
//           Ubisoft Connect, Rockstar Games Launcher, Discord.
//
// Detection order (each strategy is tried in priority order):
//   A) Saved manual path  (userData/launcher-paths/{platform}.json)
//   B) Common env-based paths  (ProgramFiles, LOCALAPPDATA, …)
//   C) Every fixed Windows drive
//   D) Windows Registry uninstall keys (HKCU + HKLM + WOW6432Node)
//   E) Protocol handler registry (steam://, com.epicgames.launcher://, …)
//   F) Start Menu / Desktop .lnk shortcuts
//   G) Currently running process (last resort)
// ============================================================

const path          = require('path');
const fs            = require('fs').promises;
const fsSync        = require('fs');
const os            = require('os');
const { execFile }  = require('child_process');
const util          = require('util');

const execFileAsync = util.promisify(execFile);

async function boundedProbe(probe, fallback, timeoutMs = 12000) {
    let timer;
    try {
        return await Promise.race([
            Promise.resolve().then(probe).catch(() => fallback),
            new Promise(resolve => { timer = setTimeout(() => resolve(fallback), timeoutMs); }),
        ]);
    } finally { clearTimeout(timer); }
}

// Windows path helpers — always use win32 semantics so paths compare correctly
// on cross-platform CI as well as the production Windows host.
const winJoin     = (...parts) => path.win32.join(...parts);
const winDirname  = (p) => path.win32.dirname(p);
// winBasename already defined inline via path.win32.basename where needed

// ── Electron app shim (works in both Electron and plain Node) ─────────────────

let _electronApp = null;
try { _electronApp = require('electron').app; } catch { /* plain Node */ }
const _app = (_electronApp && typeof _electronApp.getPath === 'function')
    ? _electronApp
    : {
        getPath(name) {
            if (name === 'userData')
                return process.env.BADDEL_TEST_USER_DATA
                    || process.env.BADDEL_USER_DATA
                    || path.join(os.tmpdir(), 'BaddelLauncher-userData');
            return os.tmpdir();
        },
    };

// ── Supported platform list ───────────────────────────────────────────────────

const SUPPORTED_PLATFORMS = ['steam', 'epic', 'gog', 'ea', 'riot', 'ubisoft', 'rockstar', 'discord'];

// ── Per-platform configuration ────────────────────────────────────────────────
// All candidate path functions are lazy (using getters) so env vars are read at
// call-time, not at module load time.

function _buildPlatformConfig() {
    const e = {
        pf:  () => process.env['ProgramFiles']      || 'C:\\Program Files',
        pfx: () => process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
        lad: () => process.env.LOCALAPPDATA         || path.join(os.homedir(), 'AppData', 'Local'),
        app: () => process.env.APPDATA              || path.join(os.homedir(), 'AppData', 'Roaming'),
        pd:  () => process.env.ProgramData          || 'C:\\ProgramData',
    };

    return {
        steam: {
            name:            'Steam',
            dialogTitle:     'Locate Steam',
            exeNames:        ['steam.exe'],
            processNames:    ['steam'],
            registryAliases: 'steam',
            shortcutAliases: 'steam',
            protocolKeys:    ['steam'],
            envCandidates:   () => [
                winJoin(e.pfx(), 'Steam', 'steam.exe'),
                winJoin(e.pf(),  'Steam', 'steam.exe'),
                winJoin('C:\\',  'Steam', 'steam.exe'),
            ],
            driveCandidates: (drive) => [
                winJoin(drive, 'Program Files (x86)', 'Steam', 'steam.exe'),
                winJoin(drive, 'Program Files',       'Steam', 'steam.exe'),
                winJoin(drive, 'Steam',               'steam.exe'),
            ],
        },
        epic: {
            name:            'Epic Games Launcher',
            dialogTitle:     'Locate Epic Games Launcher',
            exeNames:        ['EpicGamesLauncher.exe'],
            processNames:    ['EpicGamesLauncher'],
            registryAliases: 'epic|epic games launcher|epic games',
            shortcutAliases: 'epic games launcher|epic',
            protocolKeys:    ['com.epicgames.launcher'],
            envCandidates:   () => [
                winJoin(e.pfx(), 'Epic Games', 'Launcher', 'Portal', 'Binaries', 'Win64', 'EpicGamesLauncher.exe'),
                winJoin(e.pf(),  'Epic Games', 'Launcher', 'Portal', 'Binaries', 'Win64', 'EpicGamesLauncher.exe'),
            ],
            driveCandidates: (drive) => [
                winJoin(drive, 'Epic Games',                           'Launcher', 'Portal', 'Binaries', 'Win64', 'EpicGamesLauncher.exe'),
                winJoin(drive, 'Program Files',       'Epic Games',   'Launcher', 'Portal', 'Binaries', 'Win64', 'EpicGamesLauncher.exe'),
                winJoin(drive, 'Program Files (x86)', 'Epic Games',   'Launcher', 'Portal', 'Binaries', 'Win64', 'EpicGamesLauncher.exe'),
            ],
        },
        gog: {
            name:            'GOG Galaxy',
            dialogTitle:     'Locate GOG Galaxy',
            exeNames:        ['GalaxyClient.exe'],
            processNames:    ['GalaxyClient'],
            registryAliases: 'gog galaxy|gog.com galaxy|gog.com',
            shortcutAliases: 'gog galaxy|gog.com galaxy|gog',
            protocolKeys:    ['goggalaxy'],
            envCandidates:   () => [
                winJoin(e.pfx(), 'GOG Galaxy', 'GalaxyClient.exe'),
                winJoin(e.pf(),  'GOG Galaxy', 'GalaxyClient.exe'),
            ],
            driveCandidates: (drive) => [
                winJoin(drive, 'Program Files (x86)', 'GOG Galaxy', 'GalaxyClient.exe'),
                winJoin(drive, 'Program Files',       'GOG Galaxy', 'GalaxyClient.exe'),
                winJoin(drive, 'GOG Galaxy',                         'GalaxyClient.exe'),
                winJoin(drive, 'GOG',                                'GalaxyClient.exe'),
                winJoin(drive, 'Games',              'GOG Galaxy',  'GalaxyClient.exe'),
                winJoin(drive, 'Apps',               'GOG Galaxy',  'GalaxyClient.exe'),
                winJoin(drive, 'Launchers',          'GOG Galaxy',  'GalaxyClient.exe'),
            ],
        },
        ea: {
            name:            'EA App',
            dialogTitle:     'Locate EA App',
            exeNames:        ['EADesktop.exe'],
            processNames:    ['EADesktop'],
            registryAliases: 'ea app|electronic arts|origin|ea desktop',
            shortcutAliases: 'ea app|ea|origin',
            protocolKeys:    ['origin2', 'ea'],
            envCandidates:   () => [
                winJoin(e.pf(),  'Electronic Arts', 'EA Desktop', 'EA Desktop', 'EADesktop.exe'),
                winJoin(e.pfx(), 'Electronic Arts', 'EA Desktop', 'EA Desktop', 'EADesktop.exe'),
            ],
            driveCandidates: (drive) => [
                winJoin(drive, 'Program Files',       'Electronic Arts', 'EA Desktop', 'EA Desktop', 'EADesktop.exe'),
                winJoin(drive, 'Program Files (x86)', 'Electronic Arts', 'EA Desktop', 'EA Desktop', 'EADesktop.exe'),
                winJoin(drive, 'EA Games',                               'EA Desktop', 'EA Desktop', 'EADesktop.exe'),
            ],
        },
        riot: {
            name:            'Riot Client',
            dialogTitle:     'Locate Riot Client',
            exeNames:        ['RiotClientServices.exe'],
            processNames:    ['RiotClientServices'],
            registryAliases: 'riot|valorant|league of legends',
            shortcutAliases: 'riot client|riot|valorant|league',
            protocolKeys:    [],
            envCandidates:   () => [
                winJoin('C:\\',  'Riot Games', 'Riot Client', 'RiotClientServices.exe'),
                winJoin(e.pf(),  'Riot Games', 'Riot Client', 'RiotClientServices.exe'),
                winJoin(e.pfx(), 'Riot Games', 'Riot Client', 'RiotClientServices.exe'),
                winJoin(e.lad(), 'Riot Games', 'Riot Client', 'RiotClientServices.exe'),
            ],
            driveCandidates: (drive) => [
                winJoin(drive, 'Riot Games',                           'Riot Client', 'RiotClientServices.exe'),
                winJoin(drive, 'Program Files',       'Riot Games',   'Riot Client', 'RiotClientServices.exe'),
                winJoin(drive, 'Program Files (x86)', 'Riot Games',   'Riot Client', 'RiotClientServices.exe'),
            ],
        },
        ubisoft: {
            name:            'Ubisoft Connect',
            dialogTitle:     'Locate Ubisoft Connect',
            exeNames:        ['UbisoftConnect.exe', 'upc.exe'],
            processNames:    ['UbisoftConnect', 'upc'],
            registryAliases: 'ubisoft|ubisoft connect|uplay',
            shortcutAliases: 'ubisoft connect|ubisoft|uplay',
            protocolKeys:    ['uplay', 'ubisoftconnect'],
            envCandidates:   () => [
                winJoin(e.pfx(), 'Ubisoft', 'Ubisoft Game Launcher', 'UbisoftConnect.exe'),
                winJoin(e.pf(),  'Ubisoft', 'Ubisoft Game Launcher', 'UbisoftConnect.exe'),
                winJoin(e.pfx(), 'Ubisoft', 'Ubisoft Game Launcher', 'upc.exe'),
                winJoin(e.pf(),  'Ubisoft', 'Ubisoft Game Launcher', 'upc.exe'),
            ],
            driveCandidates: (drive) => [
                winJoin(drive, 'Program Files (x86)', 'Ubisoft', 'Ubisoft Game Launcher', 'UbisoftConnect.exe'),
                winJoin(drive, 'Program Files',       'Ubisoft', 'Ubisoft Game Launcher', 'UbisoftConnect.exe'),
                winJoin(drive, 'Program Files (x86)', 'Ubisoft', 'Ubisoft Game Launcher', 'upc.exe'),
                winJoin(drive, 'Program Files',       'Ubisoft', 'Ubisoft Game Launcher', 'upc.exe'),
            ],
        },
        rockstar: {
            name:            'Rockstar Games Launcher',
            dialogTitle:     'Locate Rockstar Games Launcher',
            exeNames:        ['Launcher.exe'],
            processNames:    ['Launcher'],
            registryAliases: 'rockstar|rockstar games launcher|social club',
            shortcutAliases: 'rockstar games launcher|rockstar',
            protocolKeys:    ['rockstar-games-social-club'],
            envCandidates:   () => [
                winJoin(e.pf(),  'Rockstar Games', 'Launcher', 'Launcher.exe'),
                winJoin(e.pfx(), 'Rockstar Games', 'Launcher', 'Launcher.exe'),
            ],
            driveCandidates: (drive) => [
                winJoin(drive, 'Program Files',       'Rockstar Games', 'Launcher', 'Launcher.exe'),
                winJoin(drive, 'Program Files (x86)', 'Rockstar Games', 'Launcher', 'Launcher.exe'),
                winJoin(drive, 'Rockstar Games', 'Launcher', 'Launcher.exe'),
            ],
        },
        discord: {
            name:            'Discord',
            dialogTitle:     'Locate Discord',
            exeNames:        ['Update.exe', 'Discord.exe'],
            processNames:    ['Discord'],
            registryAliases: 'discord',
            shortcutAliases: 'discord',
            protocolKeys:    [],
            envCandidates:   () => [
                winJoin(e.lad(), 'Discord', 'Update.exe'),
            ],
            driveCandidates: () => [],
        },
    };
}

let _cachedPlatformConfig = null;
function _getPlatformConfig(platform) {
    if (!_cachedPlatformConfig) _cachedPlatformConfig = _buildPlatformConfig();
    return _cachedPlatformConfig[platform] || null;
}

// Re-export so tests can read platform metadata without calling findLauncherExe.
function getPlatformInfo(platform) {
    const cfg = _getPlatformConfig(platform);
    if (!cfg) return null;
    return {
        name:       cfg.name,
        dialogTitle: cfg.dialogTitle,
        exeNames:   cfg.exeNames,
    };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function _cleanPath(p) {
    if (!p || typeof p !== 'string') return '';
    let s = p.trim().replace(/^"+|"+$/g, '');
    if (!s) return '';
    s = s.replace(/%([^%]+)%/g, (match, key) => {
        const name = Object.keys(process.env).find(name => name.toLowerCase() === key.toLowerCase());
        return name ? process.env[name] : match;
    });
    s = s.replace(/^file:\/+/i, '');
    try { return path.normalize(s); } catch { return s; }
}

function _fileExists(p) {
    if (!p) return false;
    try { return fsSync.statSync(p).isFile(); } catch { return false; }
}

function _manualPathDir() {
    return path.join(_app.getPath('userData'), 'launcher-paths');
}

function _manualPathFile(platform) {
    return path.join(_manualPathDir(), `${platform}.json`);
}

// Returns true if the path points to an exe that is valid for the given platform.
// Validation is strict: correct basename, and for Rockstar/Discord the path must
// be inside a platform-named directory to avoid false positives.
function _isValidExeForPlatform(platform, rawPath) {
    const cfg = _getPlatformConfig(platform);
    if (!cfg || !rawPath) return false;
    const p = _cleanPath(rawPath);
    if (!p) return false;
    const basename   = path.win32.basename(p).toLowerCase();
    const validNames = cfg.exeNames.map(n => n.toLowerCase());
    if (!validNames.includes(basename)) return false;
    const norm = p.toLowerCase().replace(/\\/g, '/');
    if (platform === 'rockstar' && !norm.includes('/rockstar')) return false;
    if (platform === 'discord'  && !norm.includes('/discord'))  return false;
    return true;
}

// ── Strategy: Windows drive enumeration ───────────────────────────────────────

async function _getWindowsDrives() {
    try {
        const { stdout } = await execFileAsync('powershell.exe', [
            '-NoProfile', '-NonInteractive', '-Command',
            'Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | Select-Object -ExpandProperty DeviceID',
        ], { timeout: 6000 });
        const drives = stdout.split(/\r?\n/)
            .map(d => d.trim().replace(/:$/, ''))
            .filter(d => /^[A-Za-z]$/.test(d))
            .map(d => `${d.toUpperCase()}:\\`);
        return drives.length ? drives : ['C:\\'];
    } catch {
        return ['C:\\'];
    }
}

// ── Strategy: Registry uninstall scan ────────────────────────────────────────

async function _queryRegistryForLauncher(platform) {
    const cfg = _getPlatformConfig(platform);
    if (!cfg) return [];
    // aliasPattern is a hardcoded regex pattern (not user input) — safe to embed in PS
    const aliasPattern = cfg.registryAliases;

    const script = [
        '$results = @();',
        '$hives = @("HKCU", "HKLM");',
        '$bases = @(',
        '  "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall",',
        '  "Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall"',
        ');',
        `$pat = '${aliasPattern}';`,
        'foreach ($hive in $hives) {',
        '  foreach ($base in $bases) {',
        '    $full = "${hive}:\\$base";',
        '    if (-not (Test-Path $full -ErrorAction SilentlyContinue)) { continue }',
        '    Get-ChildItem $full -ErrorAction SilentlyContinue | ForEach-Object {',
        '      $p = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue;',
        '      $dn = [string]($p.DisplayName);',
        '      if ($dn -imatch $pat) {',
        '        $results += [PSCustomObject]@{',
        '          Name=$dn;',
        '          Location=[string]($p.InstallLocation);',
        '          Icon=[string]($p.DisplayIcon);',
        '          Uninstall=[string]($p.UninstallString)',
        '        }',
        '      }',
        '    }',
        '  }',
        '};',
        'if ($results.Count -eq 0) { "[]" } else { $results | ConvertTo-Json -Compress }',
    ].join(' ');

    try {
        const { stdout } = await execFileAsync('powershell.exe', [
            '-NoProfile', '-NonInteractive', '-Command', script,
        ], { timeout: 12000 });
        const raw = stdout.trim();
        if (!raw || raw === '[]') return [];
        const data = JSON.parse(raw);
        return Array.isArray(data) ? data : [data];
    } catch { return []; }
}

// ── Strategy: Protocol handler registry ───────────────────────────────────────

async function _queryProtocolHandlers(platform, existsFn) {
    const cfg = _getPlatformConfig(platform);
    if (!cfg || !cfg.protocolKeys.length) return null;

    for (const key of cfg.protocolKeys) {
        try {
            const { stdout } = await execFileAsync('reg.exe', [
                'query', `HKCR\\${key}\\shell\\open\\command`, '/ve',
            ], { timeout: 4000 });
            // Extract quoted or unquoted exe path from REG_SZ value
            const m1 = stdout.match(/"([^"]+\.exe)"/i);
            const m2 = !m1 && stdout.match(/REG_SZ\s+(.+)/i);
            const raw = _cleanPath(((m1 && m1[1]) || (m2 && m2[1]) || '').split(',')[0]);
            if (!raw) continue;
            if (_isValidExeForPlatform(platform, raw) && existsFn(raw)) return raw;
            // Also check siblings in the same directory
            const dir = winDirname(raw);
            for (const exeName of cfg.exeNames) {
                const candidate = winJoin(dir, exeName);
                if (_isValidExeForPlatform(platform, candidate) && existsFn(candidate)) return candidate;
            }
        } catch { /* key absent or PS error — continue */ }
    }
    return null;
}

// ── Strategy: Start Menu / Desktop shortcuts ──────────────────────────────────

async function _queryGogClientRegistration() {
    const keys = [
        'HKCU\\SOFTWARE\\GOG.com\\GalaxyClient\\paths',
        'HKLM\\SOFTWARE\\GOG.com\\GalaxyClient\\paths',
        'HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\GalaxyClient\\paths',
    ];
    const candidates = [];
    await Promise.all(keys.flatMap(key => ['client', 'path'].map(async value => {
            try {
                const { stdout } = await execFileAsync('reg.exe', ['query', key, '/v', value], { timeout: 4000, windowsHide: true });
                const match = String(stdout || '').match(/REG_(?:SZ|EXPAND_SZ)\s+(.+)$/im);
                const raw = _cleanPath(match?.[1] || '');
                if (!raw) return;
                candidates.push(raw.toLowerCase().endsWith('.exe') ? raw : winJoin(raw, 'GalaxyClient.exe'));
            } catch { /* key/value absent */ }
    })));
    await Promise.all(['HKCU', 'HKLM'].flatMap(hive => ['32', '64'].map(async view => {
        try {
            const { stdout } = await execFileAsync('reg.exe', ['query', `${hive}\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\GalaxyClient.exe`, '/ve', `/reg:${view}`], { timeout: 4000, windowsHide: true });
            const match = String(stdout || '').match(/REG_(?:SZ|EXPAND_SZ)\s+(.+)$/im);
            if (match) candidates.push(_cleanPath(match[1]));
        } catch { /* App Paths is optional. */ }
    })));
    try {
        const { stdout } = await execFileAsync('reg.exe', [
            'query', 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\GalaxyClientService', '/v', 'ImagePath',
        ], { timeout: 4000, windowsHide: true });
        const match = String(stdout || '').match(/REG_(?:SZ|EXPAND_SZ)\s+(.+)$/im);
        const command = _cleanPath(match?.[1] || '');
        const serviceExe = command.match(/^"([^"]+\.exe)"/i)?.[1]
            || command.match(/^(.+?\.exe)(?:\s|$)/i)?.[1]
            || '';
        if (serviceExe) candidates.push(winJoin(winDirname(serviceExe), 'GalaxyClient.exe'));
    } catch { /* GalaxyClientService is optional. */ }
    return candidates;
}

async function _deepSearchLauncherOnDrives(platform, drives) {
    const cfg = _getPlatformConfig(platform);
    if (!cfg || process.platform !== 'win32') return [];
    const searches = [];
    for (const drive of Array.isArray(drives) ? drives : []) {
        if (!/^[A-Za-z]:\\$/.test(String(drive || ''))) continue;
        for (const exeName of cfg.exeNames) {
            searches.push((async () => {
                try {
                    const { stdout } = await execFileAsync('where.exe', ['/r', drive, exeName], {
                        timeout: 25000,
                        windowsHide: true,
                        maxBuffer: 1024 * 1024,
                    });
                    return String(stdout || '').split(/\r?\n/).map(_cleanPath).filter(Boolean);
                } catch { return []; }
            })());
        }
    }
    return (await Promise.all(searches)).flat();
}

async function _queryShortcutsForLauncher(platform) {
    const cfg = _getPlatformConfig(platform);
    if (!cfg) return [];
    const namePattern = cfg.shortcutAliases;
    const exeList     = cfg.exeNames.map(n => `'${n}'`).join(', ');

    const script = [
        '$sh = New-Object -ComObject WScript.Shell;',
        '$locs = @(',
        '  [System.Environment]::GetFolderPath("StartMenu"),',
        '  [System.Environment]::GetFolderPath("CommonStartMenu"),',
        '  [System.Environment]::GetFolderPath("Desktop"),',
        '  [System.Environment]::GetFolderPath("CommonDesktopDirectory")',
        ');',
        `$namePat = '${namePattern}';`,
        `$exeNames = @(${exeList});`,
        '$found = @();',
        'foreach ($loc in $locs) {',
        '  if (-not (Test-Path $loc -ErrorAction SilentlyContinue)) { continue }',
        '  Get-ChildItem $loc -Filter "*.lnk" -Recurse -ErrorAction SilentlyContinue |',
        '    Where-Object { $_.BaseName -imatch $namePat } |',
        '    ForEach-Object {',
        '      try {',
        '        $t = $sh.CreateShortcut($_.FullName).TargetPath;',
        '        if ($exeNames -icontains [System.IO.Path]::GetFileName($t)) { $found += $t }',
        '      } catch {}',
        '    }',
        '};',
        'if ($found.Count -eq 0) { "[]" } else { ($found | Select-Object -Unique) | ConvertTo-Json -Compress }',
    ].join(' ');

    try {
        const { stdout } = await execFileAsync('powershell.exe', [
            '-NoProfile', '-NonInteractive', '-Command', script,
        ], { timeout: 12000 });
        const raw = stdout.trim();
        if (!raw || raw === '[]') return [];
        const data = JSON.parse(raw);
        const arr  = Array.isArray(data) ? data : [data];
        return arr.map(p => _cleanPath(String(p || ''))).filter(Boolean);
    } catch { return []; }
}

// ── Strategy: Running process ──────────────────────────────────────────────────

async function _findInRunningProcesses(platform) {
    const cfg = _getPlatformConfig(platform);
    if (!cfg) return null;
    // Win32_Process.Name includes the .exe extension; cfg.exeNames already have it.
    // Use Where-Object to filter in PowerShell — avoids fragile WQL IN syntax.
    const exeNamesJson = JSON.stringify(cfg.exeNames.map(n => n.toLowerCase()));
    const script = [
        `$names = '${exeNamesJson.replace(/'/g, "''")}' | ConvertFrom-Json`,
        `$proc  = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue`,
        `        | Where-Object { $names -icontains $_.Name }`,
        `        | Select-Object -First 1`,
        `if ($proc) { $proc.ExecutablePath } else { '' }`,
    ].join('; ');

    try {
        const { stdout } = await execFileAsync('powershell.exe', [
            '-NoProfile', '-NonInteractive', '-Command', script,
        ], { timeout: 5000 });
        const p = _cleanPath(stdout.trim());
        if (p && _isValidExeForPlatform(platform, p) && _fileExists(p)) return p;
        return null;
    } catch { return null; }
}

// ── Platform-specific extras ──────────────────────────────────────────────────

// Steam: read InstallPath from HKCU\Software\Valve\Steam
async function _findSteamFromRegistry() {
    const regKeys = [
        ['HKCU\\Software\\Valve\\Steam',               'InstallPath'],
        ['HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam',  'InstallPath'],
        ['HKLM\\SOFTWARE\\Valve\\Steam',               'InstallPath'],
    ];
    for (const [key, val] of regKeys) {
        try {
            const { stdout } = await execFileAsync('reg.exe', [
                'query', key, '/v', val,
            ], { timeout: 4000 });
            const m = stdout.match(/InstallPath\s+REG_SZ\s+(.+)/i);
            if (m) {
                const steamDir = _cleanPath(m[1].trim());
                if (steamDir) return winJoin(steamDir, 'steam.exe');
            }
        } catch { /* key absent */ }
    }
    return null;
}

// Riot: read ProgramData\Riot Games\RiotClientInstalls.json
async function _readRiotClientInstalls() {
    const pd   = process.env.ProgramData || 'C:\\ProgramData';
    const file = winJoin(pd, 'Riot Games', 'RiotClientInstalls.json');
    try {
        const raw = await fs.readFile(file, 'utf8');
        return JSON.parse(raw);
    } catch { return null; }
}

// Discord: scan LOCALAPPDATA\Discord\app-*\Discord.exe
async function _scanDiscordAppDirs(existsFn) {
    const discordDir = winJoin(
        process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
        'Discord'
    );
    try {
        const entries = await fs.readdir(discordDir);
        const appDirs = entries.filter(d => d.startsWith('app-')).sort().reverse();
        for (const dir of appDirs) {
            const exe = winJoin(discordDir, dir, 'Discord.exe');
            if (existsFn(exe)) return exe;
        }
    } catch { /* directory absent */ }
    return null;
}

// ── Registry entry → exe candidate ────────────────────────────────────────────

function _exeCandidatesFromRegistryEntry(entry, cfg) {
    const results = [];
    const addCandidate = (raw) => {
        const p = _cleanPath(String(raw || '').split(',')[0]);
        if (p) results.push(p);
    };

    // 1. InstallLocation → look for each known exe name
    const loc = _cleanPath(String(entry.Location || entry.InstallLocation || ''));
    if (loc) {
        for (const exeName of cfg.exeNames) {
            results.push(winJoin(loc, exeName));
        }
    }

    // 2. DisplayIcon (strip icon-index suffix like ",0")
    const icon = _cleanPath(String(entry.Icon || entry.DisplayIcon || '').split(',')[0]);
    if (icon) {
        addCandidate(icon);
        const iconDir = winDirname(icon);
        for (const exeName of cfg.exeNames) {
            results.push(winJoin(iconDir, exeName));
        }
    }

    // 3. UninstallString → strip arguments, infer directory
    const us = String(entry.Uninstall || entry.UninstallString || '');
    const usClean = _cleanPath(
        us.replace(/^"/, '').replace(/".*$/, '').trim().split(',')[0]
    );
    if (usClean) {
        addCandidate(usClean);
        const usDir = winDirname(usClean);
        for (const exeName of cfg.exeNames) {
            results.push(winJoin(usDir, exeName));
        }
    }

    return results;
}

// ── Public: main finder ───────────────────────────────────────────────────────

/**
 * Finds the first valid launcher executable for the given platform.
 * Returns the absolute path string, or null if not found.
 *
 * All I/O helpers are injectable via `_opts` for unit testing:
 *   _opts._fileExists(path)              → bool
 *   _opts._getDrives()                   → Promise<string[]>
 *   _opts._queryRegistry()               → Promise<entry[]>
 *   _opts._queryShortcuts()              → Promise<string[]>
 *   _opts._findRunning()                 → Promise<string|null>
 *   _opts._steamRegPath()                → Promise<string|null>  (steam only)
 *   _opts._readRiotInstalls()            → Promise<object|null>  (riot only)
 *   _opts._discordAppDirs(existsFn)      → Promise<string|null>  (discord only)
 *   _opts._queryProtocol(platform, existsFn) → Promise<string|null>
 */
async function findLauncherExe(platform, _opts = {}) {
    if (!SUPPORTED_PLATFORMS.includes(platform)) {
        const err = new Error(`Unsupported platform: ${platform}`);
        err.code  = 'UNSUPPORTED_PLATFORM';
        throw err;
    }

    const cfg          = _getPlatformConfig(platform);
    const existsFn     = _opts._fileExists    || _fileExists;
    const getDrives    = _opts._getDrives     || _getWindowsDrives;
    const queryReg     = _opts._queryRegistry || (() => _queryRegistryForLauncher(platform));
    const queryShorts  = _opts._queryShortcuts|| (() => _queryShortcutsForLauncher(platform));
    const findRunning  = _opts._findRunning   || (() => _findInRunningProcesses(platform));
    const queryProto   = _opts._queryProtocol || ((pl, ef) => _queryProtocolHandlers(pl, ef));
    const deepSearch   = _opts._deepSearch || ((pl, drives) => _deepSearchLauncherOnDrives(pl, drives));
    const readManual   = _opts._readManualPath || getSavedManualLauncherPath;
    const resolved = (exePath, source) => {
        if (exePath) _opts._onResolved?.({ exePath, source });
        return exePath;
    };

    const check = (raw) => {
        const p = _cleanPath(String(raw || ''));
        return (p && _isValidExeForPlatform(platform, p) && existsFn(p)) ? p : null;
    };

    // ── A. Saved manual path ─────────────────────────────────────────────────
    const manual = await readManual(platform);
    if (manual) {
        const r = check(manual);
        if (r) return resolved(r, 'manual');
        // stale — fall through to auto-detection
    }

    // ── B. Env-based candidates ──────────────────────────────────────────────
    if (platform === 'gog') {
        const queryGogRegistration = _opts._queryGogRegistration || _queryGogClientRegistration;
        for (const candidate of await boundedProbe(queryGogRegistration, [], _opts._probeTimeoutMs)) {
            const r = check(candidate);
            if (r) return resolved(r, 'gog-registration');
        }
        const protocolCandidate = check(await boundedProbe(() => queryProto(platform, existsFn), null, _opts._probeTimeoutMs));
        if (protocolCandidate) return resolved(protocolCandidate, 'protocol');
    }

    for (const c of cfg.envCandidates()) {
        const r = check(c); if (r) return resolved(r, 'environment');
    }

    // Steam: registry InstallPath (more reliable than fixed paths)
    if (platform === 'gog') {
        const probes = [
            [async () => (await queryReg()).flatMap(entry => _exeCandidatesFromRegistryEntry(entry, cfg)), 'uninstall-registration'],
            [queryShorts, 'shortcut'],
            [async () => [await findRunning()], 'running-process'],
            [async () => (await getDrives()).flatMap(drive => cfg.driveCandidates(drive)), 'drive-scan'],
            [async () => deepSearch(platform, await getDrives()), 'deep-drive-search', _opts._deepSearchTimeoutMs || 28000],
        ];
        try {
            const hit = await Promise.any(probes.map(async ([probe, source, timeoutMs]) => {
                const candidates = await boundedProbe(probe, [], timeoutMs || _opts._probeTimeoutMs);
                for (const raw of candidates) { const exePath = check(raw); if (exePath) return { exePath, source }; }
                throw new Error('No valid Galaxy candidate');
            }));
            return resolved(hit.exePath, hit.source);
        } catch { return null; }
    }

    if (platform === 'steam') {
        const steamRegFn = _opts._steamRegPath || _findSteamFromRegistry;
        const regExe = await steamRegFn();
        if (regExe) { const r = check(regExe); if (r) return resolved(r, 'steam-registration'); }
    }

    // Riot: ProgramData/Riot Games/RiotClientInstalls.json
    if (platform === 'riot') {
        const readFn   = _opts._readRiotInstalls || _readRiotClientInstalls;
        const installs = await readFn();
        if (installs) {
            for (const key of ['rc_default', 'rc_live']) {
                const r = check(installs[key]); if (r) return resolved(r, 'riot-metadata');
            }
            for (const val of Object.values(installs.associated_client || {})) {
                const p = _cleanPath(String(val || ''));
                if (!p) continue;
                if (_isValidExeForPlatform('riot', p)) { const r = check(p); if (r) return resolved(r, 'riot-metadata'); }
                // Infer client from sibling game directory
                const lower = p.toLowerCase();
                for (const game of ['\\valorant\\', '\\league of legends\\']) {
                    const idx = lower.indexOf(game);
                    if (idx >= 0) {
                        const r = check(winJoin(p.slice(0, idx), 'Riot Client', 'RiotClientServices.exe'));
                        if (r) return resolved(r, 'riot-metadata');
                    }
                }
            }
        }
    }

    // Discord: Update.exe handled by envCandidates; also scan app-* dirs
    if (platform === 'discord') {
        const discordFn = _opts._discordAppDirs || _scanDiscordAppDirs;
        const appExe    = await discordFn(existsFn);
        if (appExe) { const r = check(appExe); if (r) return resolved(r, 'per-user-install'); }
    }

    // ── C. Every fixed Windows drive ─────────────────────────────────────────
    const drives = await getDrives();
    for (const drive of drives) {
        for (const c of cfg.driveCandidates(drive)) {
            const r = check(c); if (r) return resolved(r, 'drive-scan');
        }
    }

    // ── D. Windows Registry uninstall keys ───────────────────────────────────
    const regEntries = await queryReg();
    for (const entry of regEntries) {
        for (const candidate of _exeCandidatesFromRegistryEntry(entry, cfg)) {
            const r = check(candidate); if (r) return resolved(r, 'uninstall-registration');
        }
    }

    // ── E. Protocol handler registry ─────────────────────────────────────────
    if (platform !== 'gog') {
        const protocolCandidate = check(await queryProto(platform, existsFn));
        if (protocolCandidate) return resolved(protocolCandidate, 'protocol');
    }

    // ── F. Start Menu / Desktop shortcuts ────────────────────────────────────
    const shortcutPaths = await queryShorts();
    for (const p of shortcutPaths) { const r = check(p); if (r) return resolved(r, 'shortcut'); }

    // ── G. Currently running process ─────────────────────────────────────────
    const running = await findRunning();
    if (running) {
        const r = check(running);
        if (r) return resolved(r, 'running-process');
    }

    return null;
}

async function resolveLauncher(platform, _opts = {}) {
    let resolution = null;
    await findLauncherExe(platform, {
        ..._opts,
        _onResolved: value => { resolution = value; },
    });
    return resolution;
}

// ── Public: validate ──────────────────────────────────────────────────────────

/**
 * Validates that filePath points to the correct launcher exe for platform.
 * Throws an Error with .code on failure. Returns the normalised path on success.
 */
function validateLauncherExe(platform, filePath) {
    if (!SUPPORTED_PLATFORMS.includes(platform)) {
        const err = new Error(`Unsupported platform: ${platform}`);
        err.code  = 'UNSUPPORTED_PLATFORM';
        throw err;
    }
    const cfg = _getPlatformConfig(platform);
    const p   = _cleanPath(filePath);
    if (!p) {
        const err = new Error('No path provided.');
        err.code  = 'INVALID_PATH';
        throw err;
    }
    const basename   = path.win32.basename(p).toLowerCase();
    const validNames = cfg.exeNames.map(n => n.toLowerCase());
    if (!validNames.includes(basename)) {
        const err = new Error(
            `Expected ${cfg.exeNames.join(' or ')}, got "${path.win32.basename(p)}". ` +
            `Please select the correct executable.`
        );
        err.code = 'WRONG_EXE_NAME';
        throw err;
    }
    const norm = p.toLowerCase().replace(/\\/g, '/');
    if (platform === 'rockstar' && !norm.includes('/rockstar')) {
        const err = new Error('Launcher.exe must be inside a Rockstar Games directory.');
        err.code  = 'WRONG_EXE_NAME';
        throw err;
    }
    if (platform === 'discord' && !norm.includes('/discord')) {
        const err = new Error('The selected exe must be inside a Discord directory.');
        err.code  = 'WRONG_EXE_NAME';
        throw err;
    }
    if (!_fileExists(p)) {
        const err = new Error(`File not found: ${p}`);
        err.code  = 'FILE_NOT_FOUND';
        throw err;
    }
    return p;
}

// ── Public: manual path management ────────────────────────────────────────────

async function getSavedManualLauncherPath(platform) {
    try {
        const raw  = await fs.readFile(_manualPathFile(platform), 'utf8');
        const data = JSON.parse(raw);
        return typeof data.path === 'string' ? data.path : null;
    } catch { return null; }
}

async function saveManualLauncherPath(platform, filePath) {
    const valid = validateLauncherExe(platform, filePath); // throws if invalid
    const dir   = _manualPathDir();
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
        _manualPathFile(platform),
        JSON.stringify({ path: valid, platform, savedAt: Date.now() }),
        'utf8'
    );
    return valid;
}

async function clearManualLauncherPath(platform) {
    try { await fs.unlink(_manualPathFile(platform)); } catch { /* already absent */ }
}

// ── Public: launch spec ───────────────────────────────────────────────────────

/**
 * Returns the exe path and arguments needed to launch the given platform.
 * For Discord: Update.exe with ["--processStart", "Discord.exe"]
 *              OR Discord.exe directly when Update.exe is absent.
 * For all others: the resolved exe with no extra arguments.
 *
 * Returns null if the launcher cannot be found.
 */
async function getLauncherLaunchSpec(platform, _opts = {}) {
    const resolution = await resolveLauncher(platform, _opts);
    if (!resolution) return null;
    const { exePath, source } = resolution;
    if (platform === 'discord') {
        const basename = path.win32.basename(exePath).toLowerCase();
        if (basename === 'update.exe') {
            return { exePath, args: ['--processStart', 'Discord.exe'], source };
        }
        return { exePath, args: [], source };
    }
    return { exePath, args: [], source };
}

// ── Public: diagnostics ───────────────────────────────────────────────────────

/**
 * Returns a diagnostics snapshot for the given platform.
 * Useful for showing the user what was searched when auto-detection fails.
 */
async function getLauncherDetectionDiagnostics(platform, _opts = {}) {
    if (!SUPPORTED_PLATFORMS.includes(platform)) return { error: 'Unsupported platform' };

    const cfg      = _getPlatformConfig(platform);
    const existsFn = _opts._fileExists || _fileExists;
    const getDrives= _opts._getDrives  || _getWindowsDrives;

    const drives   = await getDrives().catch(() => ['C:\\']);
    const manual   = await getSavedManualLauncherPath(platform);

    const checkedPaths = [
        ...cfg.envCandidates(),
        ...drives.flatMap(d => cfg.driveCandidates(d)),
    ];

    return {
        platform,
        name:             cfg.name,
        manualPathSaved:  manual || null,
        manualPathValid:  manual ? existsFn(manual) : false,
        checkedPaths:     [...new Set(checkedPaths)].map(p => ({ path: p, exists: existsFn(p) })),
        drives,
        exeNames:         cfg.exeNames,
    };
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
    // Core
    findLauncherExe,
    resolveLauncher,
    validateLauncherExe,
    getLauncherLaunchSpec,
    // Manual path management
    saveManualLauncherPath,
    getSavedManualLauncherPath,
    clearManualLauncherPath,
    // Diagnostics / metadata
    getLauncherDetectionDiagnostics,
    getPlatformInfo,
    // Constants
    SUPPORTED_PLATFORMS,
};
