'use strict';
/**
 * PlaytimeOsHelper
 * Windows foreground-window + user-idle detection for the activity-aware
 * playtime tracker.  Spawns ONE persistent PowerShell process per app session
 * so Add-Type is compiled once and every subsequent query is near-instant.
 *
 * Gracefully degrades: if PowerShell is unavailable (test env, no Windows)
 * both APIs return null / 0 so callers treat state as "unknown / not idle".
 *
 * Set env BADDEL_SKIP_OS_HELPER=1 to disable in tests.
 */

const { spawn } = require('child_process');
const path      = require('path');
const fs        = require('fs');
const os        = require('os');

// ── PowerShell helper script ──────────────────────────────────────────────────
// Compiled once by Add-Type, then reads commands from stdin line-by-line.
// Responses go to stdout one line per command.
const PS_SCRIPT = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class BaddelWin32Helper {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern int GetWindowTextLength(IntPtr hWnd);

    public static string GetWindowTitle(IntPtr hWnd) {
        int length = GetWindowTextLength(hWnd);
        if (length <= 0) return "";
        System.Text.StringBuilder builder = new System.Text.StringBuilder(length + 1);
        GetWindowText(hWnd, builder, builder.Capacity);
        return builder.ToString();
    }
    [StructLayout(LayoutKind.Sequential)]
    public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
    [DllImport("user32.dll")]
    public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
    public static uint GetIdleMs() {
        LASTINPUTINFO lii = new LASTINPUTINFO();
        lii.cbSize = (uint)System.Runtime.InteropServices.Marshal.SizeOf(lii);
        GetLastInputInfo(ref lii);
        return (uint)Environment.TickCount - lii.dwTime;
    }
}
"@ -ErrorAction SilentlyContinue
while ($true) {
    try {
        $line = [Console]::In.ReadLine()
        if ($null -eq $line -or $line -ceq 'EXIT') { break }
        if ($line -ceq 'FOREGROUND') {
            $hwnd   = [BaddelWin32Helper]::GetForegroundWindow()
            $title  = ''
            try { $title = [BaddelWin32Helper]::GetWindowTitle($hwnd) } catch {}
            $fgPid  = [uint32]0
            [BaddelWin32Helper]::GetWindowThreadProcessId($hwnd, [ref]$fgPid) | Out-Null
            $p = Get-Process -Id ([int]$fgPid) -ErrorAction SilentlyContinue
            if ($null -ne $p) {
                $exe = ''
                # Try MainModule.FileName first (fast, works for most processes)
                try { $exe = $p.MainModule.FileName } catch {}
                # Fallback to WMI/CIM when MainModule is inaccessible (e.g. 32-bit host querying 64-bit process)
                if ([string]::IsNullOrEmpty($exe)) {
                    try {
                        $cim = Get-CimInstance Win32_Process -Filter "ProcessId = $($p.Id)" -ErrorAction SilentlyContinue
                        if ($null -ne $cim) { $exe = $cim.ExecutablePath }
                    } catch {}
                }
                $exe = ($exe -replace '\\\\','/') -replace '"',''
                $obj = [PSCustomObject]@{ pid = $p.Id; name = $p.Name.ToLower(); executable = $exe; title = $title }
                [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress))
            } else {
                [Console]::Out.WriteLine('{"pid":0,"name":"","executable":"","title":""}')
            }
        } elseif ($line -ceq 'IDLE') {
            [Console]::Out.WriteLine([BaddelWin32Helper]::GetIdleMs())
        } else {
            [Console]::Out.WriteLine('null')
        }
        [Console]::Out.Flush()
    } catch {
        [Console]::Error.WriteLine('[BaddelPS] FOREGROUND FAILED: ' + $_.Exception.Message)
        [Console]::Out.WriteLine('null')
        [Console]::Out.Flush()
    }
}
`.trim();

const CACHE_TTL_MS   = 2_000;
const QUERY_TIMEOUT  = 5_000;

class PlaytimeOsHelper {
    constructor() {
        this._proc       = null;
        this._queue      = [];
        this._buf        = '';
        this._scriptPath = null;
        this._fgCache    = { ts: 0, value: null };
        this._idleCache  = { ts: 0, value: 0 };
        this._disabled   = process.env.BADDEL_SKIP_OS_HELPER === '1' ||
                           process.platform !== 'win32';
    }

    _writeScript() {
        if (this._scriptPath) return this._scriptPath;
        this._scriptPath = path.join(os.tmpdir(), 'baddel_fg_helper_v2.ps1');
        try {
            fs.writeFileSync(this._scriptPath, PS_SCRIPT, 'utf8');
        } catch (e) {
            console.warn('[PlaytimeOsHelper] cannot write PS script:', e.message);
            this._disabled = true;
        }
        return this._scriptPath;
    }

    _ensureProc() {
        if (this._disabled || this._proc) return;
        try {
            const script = this._writeScript();
            if (this._disabled) return;
            this._proc = spawn('powershell.exe', [
                '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
                '-File', script,
            ], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });

            // ── Pipe stderr so Add-Type / runtime errors are visible ──────────
            this._proc.stderr.on('data', (chunk) => {
                const msg = chunk.toString().trim();
                if (msg) console.warn('[PlaytimeOsHelper] ps stderr:', msg);
            });

            this._proc.stdout.on('data', (chunk) => {
                this._buf += chunk.toString();
                let nl;
                while ((nl = this._buf.indexOf('\n')) !== -1) {
                    const line = this._buf.slice(0, nl).trim();
                    this._buf  = this._buf.slice(nl + 1);
                    if (this._queue.length > 0) {
                        const { resolve, timer } = this._queue.shift();
                        clearTimeout(timer);
                        resolve(line || null);
                    }
                }
            });

            this._proc.on('exit', () => {
                this._proc = null;
                while (this._queue.length > 0) {
                    const { resolve, timer } = this._queue.shift();
                    clearTimeout(timer);
                    resolve(null);
                }
            });

            this._proc.on('error', () => {
                this._proc    = null;
                this._disabled = true;
            });
        } catch (err) {
            console.warn('[PlaytimeOsHelper] spawn failed:', err.message);
            this._proc    = null;
            this._disabled = true;
        }
    }

    _query(cmd) {
        return new Promise((resolve) => {
            this._ensureProc();
            if (!this._proc) { resolve(null); return; }
            const timer = setTimeout(() => {
                const idx = this._queue.findIndex(e => e.resolve === resolve);
                if (idx !== -1) this._queue.splice(idx, 1);
                resolve(null);
            }, QUERY_TIMEOUT);
            this._queue.push({ cmd, resolve, timer });
            try {
                this._proc.stdin.write(cmd + '\n');
            } catch {
                clearTimeout(timer);
                this._queue.pop();
                this._proc = null;
                resolve(null);
            }
        });
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /** Returns { pid, name, executable } of the current foreground process,
     *  or null when unavailable. Result is cached for CACHE_TTL_MS. */
    async getForegroundProcess() {
        if (this._disabled) return null;
        const now = Date.now();
        if (now - this._fgCache.ts < CACHE_TTL_MS) return this._fgCache.value;
        try {
            const raw = await this._query('FOREGROUND');
            if (!raw || raw === 'null') { this._fgCache = { ts: now, value: null }; return null; }
            const parsed = JSON.parse(raw);
            this._fgCache = { ts: now, value: parsed };
            return parsed;
        } catch (e) {
            console.warn('[PlaytimeOsHelper] FOREGROUND parse error:', e.message);
            this._fgCache = { ts: now, value: null };
            return null;
        }
    }

    /** Returns milliseconds since last mouse/keyboard activity.
     *  Returns 0 when unavailable. Cached for CACHE_TTL_MS. */
    async getIdleMs() {
        if (this._disabled) return 0;
        const now = Date.now();
        if (now - this._idleCache.ts < CACHE_TTL_MS) return this._idleCache.value;
        try {
            const raw = await this._query('IDLE');
            if (!raw || raw === 'null') { this._idleCache = { ts: now, value: 0 }; return 0; }
            const ms = parseInt(raw, 10);
            const value = isNaN(ms) ? 0 : ms;
            this._idleCache = { ts: now, value };
            return value;
        } catch {
            return 0;
        }
    }

    shutdown() {
        if (this._proc) {
            try { this._proc.stdin.write('EXIT\n'); } catch {}
            this._proc = null;
        }
        if (this._scriptPath) {
            try { fs.unlinkSync(this._scriptPath); } catch {}
            this._scriptPath = null;
        }
    }
}

module.exports = new PlaytimeOsHelper();