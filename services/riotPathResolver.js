'use strict';

// ============================================================
// RIOT PATH RESOLVER
// Single authoritative source for locating RiotClientServices.exe.
// Used by accountsHandler.js. Detection strategies, in priority order:
//   A) Saved manual path from userData
//   B) Common env-based paths (C:\Riot Games, %ProgramFiles%, %LOCALAPPDATA%)
//   C) ProgramData\Riot Games\RiotClientInstalls.json
//   D) Every accessible Windows drive
//   E) Windows Uninstall registry (HKCU + HKLM + WOW6432Node)
//   F) Start Menu / Desktop .lnk shortcuts
//   G) Currently running RiotClientServices.exe process
// ============================================================

const path          = require('path');
const fs            = require('fs').promises;
const fsSync        = require('fs');
const os            = require('os');
const { execFile }  = require('child_process');
const util          = require('util');

const execFileAsync = util.promisify(execFile);

// ---- Electron app shim (works in both Electron and plain Node test runner) ----
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

// ─── Constants ────────────────────────────────────────────────────────────────

const RIOT_EXE_NAME = 'RiotClientServices.exe';

// ─── Internal helpers ─────────────────────────────────────────────────────────

function _cleanPath(p) {
    if (!p || typeof p !== 'string') return '';
    let s = p.trim().replace(/^"+|"+$/g, '');
    if (!s) return '';
    s = s.replace(/^file:\/+/i, '');
    try { return path.normalize(s); } catch { return s; }
}

function _fileExists(p) {
    if (!p) return false;
    try { return fsSync.statSync(p).isFile(); } catch { return false; }
}

function _isRiotClientExe(p) {
    return path.basename(_cleanPath(String(p || ''))).toLowerCase() === RIOT_EXE_NAME.toLowerCase();
}

function _manualPathFile() {
    return path.join(_app.getPath('userData'), 'riot_client_manual_path.json');
}

// ─── Strategy helpers (injectable for tests via _opts) ────────────────────────

async function _getWindowsDrives() {
    try {
        const { stdout } = await execFileAsync('powershell.exe', [
            '-NoProfile', '-NonInteractive', '-Command',
            'Get-PSDrive -PSProvider FileSystem | Select-Object -ExpandProperty Name',
        ], { timeout: 5000 });
        const drives = stdout.split(/\r?\n/)
            .map(d => d.trim())
            .filter(Boolean)
            .map(d => `${d}:\\`);
        return drives.length ? drives : ['C:\\'];
    } catch {
        return ['C:\\'];
    }
}

async function _readRiotClientInstalls(_programData) {
    const pd = _programData || process.env.ProgramData || 'C:\\ProgramData';
    const file = path.join(pd, 'Riot Games', 'RiotClientInstalls.json');
    try {
        const raw = await fs.readFile(file, 'utf8');
        return JSON.parse(raw);
    } catch { return null; }
}

async function _queryRegistryForRiotEntries() {
    // Query HKCU and HKLM uninstall keys (normal + WOW6432Node) for any
    // entry whose DisplayName contains Riot / VALORANT / League of Legends.
    const script = [
        '$results = @();',
        '$hives = @("HKCU", "HKLM");',
        '$bases = @(',
        '  "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall",',
        '  "Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall"',
        ');',
        'foreach ($hive in $hives) {',
        '  foreach ($base in $bases) {',
        '    $full = "${hive}:\\$base";',
        '    if (-not (Test-Path $full -ErrorAction SilentlyContinue)) { continue }',
        '    Get-ChildItem $full -ErrorAction SilentlyContinue | ForEach-Object {',
        '      $p = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue;',
        '      $dn = [string]($p.DisplayName);',
        '      if ($dn -imatch "riot|valorant|league of legends") {',
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

async function _queryShortcutsForRiotExe() {
    // Resolve .lnk shortcuts in Start Menu and Desktop that target
    // RiotClientServices.exe.  Uses WScript.Shell COM via PowerShell.
    const script = [
        '$sh = New-Object -ComObject WScript.Shell;',
        '$locs = @(',
        '  [System.Environment]::GetFolderPath("StartMenu"),',
        '  [System.Environment]::GetFolderPath("CommonStartMenu"),',
        '  [System.Environment]::GetFolderPath("Desktop"),',
        '  [System.Environment]::GetFolderPath("CommonDesktopDirectory")',
        ');',
        '$found = @();',
        'foreach ($loc in $locs) {',
        '  if (-not (Test-Path $loc -ErrorAction SilentlyContinue)) { continue }',
        '  Get-ChildItem $loc -Filter "*.lnk" -Recurse -ErrorAction SilentlyContinue |',
        '    Where-Object { $_.Name -imatch "riot|valorant|league" } |',
        '    ForEach-Object {',
        '      try {',
        '        $t = $sh.CreateShortcut($_.FullName).TargetPath;',
        '        if ($t -imatch "RiotClientServices\\.exe") { $found += $t }',
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

async function _findRiotInRunningProcesses() {
    try {
        const { stdout } = await execFileAsync('powershell.exe', [
            '-NoProfile', '-NonInteractive', '-Command',
            'try { (Get-Process -Name "RiotClientServices" -ErrorAction Stop | Select-Object -First 1).Path } catch { "" }',
        ], { timeout: 5000 });
        const p = _cleanPath(stdout.trim());
        return (p && _isRiotClientExe(p) && _fileExists(p)) ? p : null;
    } catch { return null; }
}

// ─── Public: validate ─────────────────────────────────────────────────────────

/**
 * Validates that `filePath` points to a real RiotClientServices.exe.
 * Throws an Error with `.code` set if validation fails.
 * Returns the normalised absolute path on success.
 */
function validateRiotClientExe(filePath) {
    const p = _cleanPath(filePath);
    if (!p) {
        const err = new Error('No path provided.');
        err.code = 'INVALID_PATH';
        throw err;
    }
    if (!_isRiotClientExe(p)) {
        const err = new Error(
            `Expected ${RIOT_EXE_NAME}, got "${path.basename(p)}". ` +
            `Please select RiotClientServices.exe.`
        );
        err.code = 'WRONG_EXE_NAME';
        throw err;
    }
    if (!_fileExists(p)) {
        const err = new Error(`File not found: ${p}`);
        err.code = 'FILE_NOT_FOUND';
        throw err;
    }
    return p;
}

// ─── Public: manual path management ──────────────────────────────────────────

async function getSavedManualRiotClientPath() {
    try {
        const raw = await fs.readFile(_manualPathFile(), 'utf8');
        const data = JSON.parse(raw);
        return typeof data.path === 'string' ? data.path : null;
    } catch { return null; }
}

async function saveManualRiotClientPath(filePath) {
    const valid = validateRiotClientExe(filePath); // throws if invalid
    const dir   = path.dirname(_manualPathFile());
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
        _manualPathFile(),
        JSON.stringify({ path: valid, savedAt: Date.now() }),
        'utf8'
    );
    return valid;
}

async function clearSavedManualRiotClientPath() {
    try { await fs.unlink(_manualPathFile()); } catch { /* already absent */ }
}

// ─── Public: candidate lists ──────────────────────────────────────────────────

/**
 * Returns all Riot installation root candidates (directories like C:\Riot Games).
 * Async because drive enumeration is async.
 * @param {object} [_opts]  Injectable overrides for testing.
 */
async function getRiotRootCandidates(_opts = {}) {
    const getDrives    = _opts._getDrives    || _getWindowsDrives;
    const readInstalls = _opts._readInstalls || _readRiotClientInstalls;

    const roots = new Map();
    const addRoot = (raw) => {
        const p = _cleanPath(String(raw || ''));
        if (!p) return;
        const key = p.toLowerCase().replace(/[\\\/]+$/, '');
        if (!roots.has(key)) roots.set(key, p);
    };

    // From RiotClientInstalls.json
    const installs = await readInstalls();
    if (installs) {
        for (const key of ['rc_default', 'rc_live']) {
            const p = _cleanPath(installs[key] || '');
            if (p) {
                const lower = p.toLowerCase();
                if (lower.includes('\\riot client\\'))
                    addRoot(p.slice(0, lower.indexOf('\\riot client\\')));
                else
                    addRoot(path.dirname(path.dirname(p)));
            }
        }
        for (const [k, v] of Object.entries(installs.associated_client || {})) {
            const p = _cleanPath(String(v || ''));
            if (!p) continue;
            const lower = p.toLowerCase();
            if (k.toLowerCase().includes('valorant') || lower.includes('\\valorant\\')) {
                const idx = lower.indexOf('\\valorant\\');
                if (idx >= 0) addRoot(p.slice(0, idx));
            }
            if (k.toLowerCase().includes('league') || lower.includes('\\league of legends\\')) {
                const idx = lower.indexOf('\\league of legends\\');
                if (idx >= 0) addRoot(p.slice(0, idx));
            }
        }
    }

    // Env-based roots
    const pf   = process.env['ProgramFiles']      || 'C:\\Program Files';
    const pfx  = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const lad  = process.env.LOCALAPPDATA         || path.join(os.homedir(), 'AppData', 'Local');
    addRoot(path.join('C:\\', 'Riot Games'));
    addRoot(path.join(pf,  'Riot Games'));
    addRoot(path.join(pfx, 'Riot Games'));
    addRoot(path.join(lad, 'Riot Games'));

    // All drives
    const drives = await getDrives();
    for (const drive of drives) {
        addRoot(path.join(drive, 'Riot Games'));
        addRoot(path.join(drive, 'Program Files',       'Riot Games'));
        addRoot(path.join(drive, 'Program Files (x86)', 'Riot Games'));
    }

    return [...roots.values()];
}

/**
 * Returns every plausible RiotClientServices.exe path derived from all
 * known roots and strategies.  Deduplicated, ordered by detection priority.
 * @param {object} [_opts]  Injectable overrides for testing.
 */
async function getRiotClientCandidates(_opts = {}) {
    const getDrives    = _opts._getDrives    || _getWindowsDrives;
    const readInstalls = _opts._readInstalls || _readRiotClientInstalls;

    const seen = new Map();
    const add  = (p, source) => {
        const c = _cleanPath(String(p || ''));
        if (!c) return;
        const key = c.toLowerCase();
        if (!seen.has(key)) seen.set(key, { path: c, source });
    };

    // A. Manual
    const manual = await getSavedManualRiotClientPath();
    if (manual) add(manual, 'manual');

    // B. Env-based
    const pf   = process.env['ProgramFiles']      || 'C:\\Program Files';
    const pfx  = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const lad  = process.env.LOCALAPPDATA         || path.join(os.homedir(), 'AppData', 'Local');
    add(path.join('C:\\', 'Riot Games', 'Riot Client', RIOT_EXE_NAME), 'env_c_drive');
    add(path.join(pf,  'Riot Games', 'Riot Client', RIOT_EXE_NAME), 'env_program_files');
    add(path.join(pfx, 'Riot Games', 'Riot Client', RIOT_EXE_NAME), 'env_program_files_x86');
    add(path.join(lad, 'Riot Games', 'Riot Client', RIOT_EXE_NAME), 'env_localappdata');

    // C. RiotClientInstalls.json
    const installs = await readInstalls();
    if (installs) {
        for (const key of ['rc_default', 'rc_live']) {
            const p = _cleanPath(installs[key] || '');
            if (p && _isRiotClientExe(p)) add(p, 'riot_installs_json');
        }
        for (const val of Object.values(installs.associated_client || {})) {
            const p = _cleanPath(String(val || ''));
            if (p && _isRiotClientExe(p)) add(p, 'riot_installs_json_assoc');
        }
    }

    // D. All drives
    const drives = await getDrives();
    for (const drive of drives) {
        for (const sub of ['', 'Program Files\\', 'Program Files (x86)\\']) {
            add(path.join(drive, sub + 'Riot Games', 'Riot Client', RIOT_EXE_NAME), `drive:${drive}`);
        }
    }

    return [...seen.values()].map(c => c.path);
}

// ─── Public: main finder ──────────────────────────────────────────────────────

/**
 * Finds the first valid RiotClientServices.exe on this machine.
 * Returns the absolute path string, or null if not found.
 *
 * All I/O helpers are injectable via `_opts` for unit testing.
 * @param {object} [_opts]
 */
async function findRiotClientExe(_opts = {}) {
    const exists        = _opts._fileExists        || _fileExists;
    const getDrives     = _opts._getDrives         || _getWindowsDrives;
    const readInstalls  = _opts._readInstalls      || _readRiotClientInstalls;
    const queryRegistry = _opts._queryRegistry     || _queryRegistryForRiotEntries;
    const queryShorts   = _opts._queryShortcuts    || _queryShortcutsForRiotExe;
    const findRunning   = _opts._findRunning       || _findRiotInRunningProcesses;

    const check = (raw) => {
        const p = _cleanPath(String(raw || ''));
        return (p && _isRiotClientExe(p) && exists(p)) ? p : null;
    };

    // A. Saved manual path (checked even if stale to give clear feedback)
    const manual = await getSavedManualRiotClientPath();
    if (manual) {
        const r = check(manual);
        if (r) return r;
        // stale — continue to auto-detect
    }

    // B. Common env-based paths
    const pf   = process.env['ProgramFiles']      || 'C:\\Program Files';
    const pfx  = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const lad  = process.env.LOCALAPPDATA         || path.join(os.homedir(), 'AppData', 'Local');
    const envCandidates = [
        path.join('C:\\', 'Riot Games', 'Riot Client', RIOT_EXE_NAME),
        path.join(pf,  'Riot Games', 'Riot Client', RIOT_EXE_NAME),
        path.join(pfx, 'Riot Games', 'Riot Client', RIOT_EXE_NAME),
        path.join(lad, 'Riot Games', 'Riot Client', RIOT_EXE_NAME),
    ];
    for (const c of envCandidates) { const r = check(c); if (r) return r; }

    // C. ProgramData/Riot Games/RiotClientInstalls.json
    const installs = await readInstalls();
    if (installs) {
        // Direct client registrations
        for (const key of ['rc_default', 'rc_live']) {
            const r = check(installs[key]);
            if (r) return r;
        }
        // Associated client map (may contain exe paths or game paths)
        for (const val of Object.values(installs.associated_client || {})) {
            const p = _cleanPath(String(val || ''));
            if (!p) continue;
            // Direct exe reference
            if (_isRiotClientExe(p)) { const r = check(p); if (r) return r; }
            // Infer client from sibling game directory
            const lower = p.toLowerCase();
            let root = null;
            if (lower.includes('\\valorant\\'))           root = p.slice(0, lower.indexOf('\\valorant\\'));
            else if (lower.includes('\\league of legends\\')) root = p.slice(0, lower.indexOf('\\league of legends\\'));
            if (root) {
                const r = check(path.join(root, 'Riot Client', RIOT_EXE_NAME));
                if (r) return r;
            }
        }
    }

    // D. Every accessible Windows drive
    const drives = await getDrives();
    for (const drive of drives) {
        const driveCandidates = [
            path.join(drive, 'Riot Games',                           'Riot Client', RIOT_EXE_NAME),
            path.join(drive, 'Program Files',       'Riot Games',   'Riot Client', RIOT_EXE_NAME),
            path.join(drive, 'Program Files (x86)', 'Riot Games',   'Riot Client', RIOT_EXE_NAME),
        ];
        for (const c of driveCandidates) { const r = check(c); if (r) return r; }
    }

    // E. Windows Registry (HKCU + HKLM + WOW6432Node uninstall keys)
    const regEntries = await queryRegistry();
    for (const entry of regEntries) {
        // InstallLocation → look for Riot Client subfolder
        const loc = _cleanPath(String(entry.Location || entry.InstallLocation || ''));
        if (loc) {
            const r1 = check(path.join(loc, 'Riot Client', RIOT_EXE_NAME));
            if (r1) return r1;
            const r2 = check(path.join(loc, RIOT_EXE_NAME));
            if (r2) return r2;
        }
        // DisplayIcon often contains the exe path (possibly comma-suffixed icon index)
        const icon = _cleanPath(String(entry.Icon || entry.DisplayIcon || '').split(',')[0]);
        if (icon && _isRiotClientExe(icon)) { const r = check(icon); if (r) return r; }
        // UninstallString → strip quotes and infer directory
        const us = String(entry.Uninstall || entry.UninstallString || '');
        const usClean = _cleanPath(us.replace(/^"/, '').replace(/".*$/, '').split(',')[0]);
        if (usClean) {
            const dir = path.dirname(usClean);
            const r = check(path.join(dir, RIOT_EXE_NAME));
            if (r) return r;
        }
    }

    // F. Start Menu / Desktop shortcuts
    const shortcutPaths = await queryShorts();
    for (const p of shortcutPaths) { const r = check(p); if (r) return r; }

    // G. Currently running process (last resort; user may have launched Riot manually)
    const running = await findRunning();
    if (running) return running;

    return null;
}

// ─── Public: diagnostics ─────────────────────────────────────────────────────

/**
 * Returns a diagnostic snapshot useful for showing the user what was tried
 * when auto-detection fails.
 * @param {object} [_opts]  Injectable overrides for testing.
 */
async function getRiotDetectionDiagnostics(_opts = {}) {
    const exists    = _opts._fileExists || _fileExists;
    const getDrives = _opts._getDrives  || _getWindowsDrives;

    const drives = await getDrives().catch(() => ['C:\\']);
    const manual = await getSavedManualRiotClientPath();

    const pf  = process.env['ProgramFiles']      || 'C:\\Program Files';
    const pfx = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const lad = process.env.LOCALAPPDATA         || path.join(os.homedir(), 'AppData', 'Local');
    const pd  = process.env.ProgramData          || 'C:\\ProgramData';

    const checked = [
        path.join('C:\\', 'Riot Games',  'Riot Client', RIOT_EXE_NAME),
        path.join(pf,     'Riot Games',  'Riot Client', RIOT_EXE_NAME),
        path.join(pfx,    'Riot Games',  'Riot Client', RIOT_EXE_NAME),
        path.join(lad,    'Riot Games',  'Riot Client', RIOT_EXE_NAME),
        ...drives.flatMap(d => [
            path.join(d, 'Riot Games',                           'Riot Client', RIOT_EXE_NAME),
            path.join(d, 'Program Files',       'Riot Games',   'Riot Client', RIOT_EXE_NAME),
            path.join(d, 'Program Files (x86)', 'Riot Games',   'Riot Client', RIOT_EXE_NAME),
        ]),
    ];

    return {
        manualPathSaved:            manual || null,
        manualPathValid:            manual ? exists(manual) : false,
        checkedPaths:               [...new Set(checked)].map(p => ({ path: p, exists: exists(p) })),
        drives,
        programData:                pd,
        riotClientInstallsExists:   exists(path.join(pd, 'Riot Games', 'RiotClientInstalls.json')),
    };
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
    // Core
    findRiotClientExe,
    validateRiotClientExe,
    // Candidate lists
    getRiotRootCandidates,
    getRiotClientCandidates,
    // Manual path management
    saveManualRiotClientPath,
    getSavedManualRiotClientPath,
    clearSavedManualRiotClientPath,
    // Diagnostics
    getRiotDetectionDiagnostics,
    // Constants (exposed for tests)
    RIOT_EXE_NAME,
};
