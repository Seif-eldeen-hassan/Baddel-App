'use strict';

// ============================================================
// steamBridge.js — Baddel Launcher
// ============================================================
// Manages the baddel_bridge.py subprocess and exposes a clean
// async API to the rest of the Electron app.
//
// Usage:
//   const bridge = require('./steamBridge');
//   await bridge.start();
//   const result = await bridge.authenticate(storedCreds);
//   await bridge.waitForCacheReady();
//   const { games } = await bridge.getOwnedGames();
// ============================================================

const path        = require('path');
const fs          = require('fs');
const { spawn }   = require('child_process');
const EventEmitter = require('events');
const { validateCacheForWrite, redactSecrets } = require('./services/credentialValidator');

// ─── Whole-file encryption constants ─────────────────────────
const _CACHE_WF_VERSION = 'dpapi-v1';

function _getSafeStorage() {
    try { return require('electron').safeStorage; } catch { return null; }
}

// ─── Paths ───────────────────────────────────────────────────
// app.getPath() only works inside Electron — use a lazy getter
function _getApp() { return require('electron').app; }
function _getCacheFile() {
    return path.join(_getApp().getPath('userData'), 'platform-sync', 'steam_bridge_cache.json');
}

/**
 * Pure path resolver — accepts explicit parameters so it can be called from
 * tests without requiring Electron.
 *
 * Packaged mode: prefers steam-runtime/baddel_bridge/baddel_bridge.exe.
 *                Never falls back to python_env in production.
 * Dev mode:      prefers python_env venv. Falls back to system Python only
 *                when BADDEL_ALLOW_SYSTEM_PYTHON=1 is set.
 *
 * @param {boolean}  isPackaged
 * @param {string}   base
 * @param {function} [existsFn]  Defaults to fs.existsSync (override in tests)
 * @param {function} [envFn]     Defaults to (k) => process.env[k] (override in tests)
 *
 * Returns a diagnostics-rich object consumed by start() and diagnoseSteamRuntime().
 */
function _resolveRuntimePaths(isPackaged, base, existsFn, envFn) {
    const exists = existsFn || fs.existsSync;
    const getEnv = typeof envFn === 'function' ? envFn : (k) => process.env[k];

    // New PyInstaller --onefile path:
    //   steam-runtime/baddel_bridge.exe
    //
    // Old PyInstaller --onedir path kept as fallback:
    //   steam-runtime/baddel_bridge/baddel_bridge.exe
    const bridgeExeCandidates = [
        path.join(base, 'steam-runtime', 'baddel_bridge.exe'),
        path.join(base, 'steam-runtime', 'baddel_bridge', 'baddel_bridge.exe'),
    ];

    const bridgeExe = bridgeExeCandidates.find(p => exists(p)) || bridgeExeCandidates[0];
    const bridgeExeDir = path.dirname(bridgeExe);

    const bridgeScript = path.join(base, 'baddel-steam-integration', 'src', 'baddel_bridge.py');
    const bridgeSrcDir = path.join(base, 'baddel-steam-integration', 'src');

    const bridgeExeExists = exists(bridgeExe);
    const bridgeScriptExists = exists(bridgeScript);

    if (isPackaged) {
        const runtimeMode = 'pyinstaller-exe';
        const error = bridgeExeExists ? null : 'Steam runtime is missing from this build.';
        const diagnostics = {
            isPackaged: true,
            runtimeMode,
            base,
            bridgeExe,
            bridgeExeDir,
            bridgeExeExists,
            bridgeExeCandidates,
            pythonExe: null,
            pythonExists: null,
            bridgeScript,
            bridgeScriptExists,
            canRunBridgeVersionCheck: bridgeExeExists,
            error,
        };

        return {
            bridgeExe,
            bridgeExeDir,
            bridgeExeExists,
            pythonBin: null,
            bridgeScript,
            bridgeSrcDir,
            runtimeMode,
            diagnostics,
        };
    }

    // Dev mode — prefer python_env venv; fall back to system Python only when
    // BADDEL_ALLOW_SYSTEM_PYTHON=1 is explicitly set.
    const allowSystemPython = getEnv('BADDEL_ALLOW_SYSTEM_PYTHON') === '1';

    const pythonEnvExe  = path.join(base, 'python_env', 'Scripts', 'python.exe');
    const pythonEnvBin3 = path.join(base, 'python_env', 'bin', 'python3');
    const pythonEnvBin  = path.join(base, 'python_env', 'bin', 'python');

    const pythonEnvExists = exists(pythonEnvExe) || exists(pythonEnvBin3) || exists(pythonEnvBin);

    const requirementsPath = path.join(base, 'baddel-steam-integration', 'requirements.txt');

    const pythonCandidates = [
        { p: pythonEnvExe,  system: false },
        { p: pythonEnvBin3, system: false },
        { p: pythonEnvBin,  system: false },
    ];

    if (allowSystemPython) {
        pythonCandidates.push(
            { p: 'python3', system: true },
            { p: 'python',  system: true },
        );
    }

    const checked = [];
    let pythonBin = null;
    let pythonExists = null;

    for (const { p, system } of pythonCandidates) {
        if (system) {
            checked.push({ path: p, exists: 'system-path' });
            pythonBin = p;
            pythonExists = 'system-path';
            break;
        }

        const e = exists(p);
        checked.push({ path: p, exists: e });

        if (e) {
            pythonBin = p;
            pythonExists = true;
            break;
        }
    }

    const runtimeMode = 'python-source';
    let error = null;
    if (!pythonBin) {
        error = allowSystemPython
            ? 'No Python found. Run scripts/build-python-env.bat or install Python 3.11.'
            : 'Steam Python environment is missing. Run scripts/build-python-env.bat';
    }

    const diagnostics = {
        isPackaged: false,
        runtimeMode,
        base,
        bridgeExe,
        bridgeExeDir,
        bridgeExeExists,
        bridgeExeCandidates,
        pythonExe: pythonBin,
        pythonExists,
        selectedPython: pythonBin,
        pythonEnvExists,
        requirementsPath,
        bridgeScript,
        bridgeScriptExists,
        canRunBridgeVersionCheck: !!pythonBin || bridgeExeExists,
        error,
        checked,
    };

    return {
        bridgeExe,
        bridgeExeDir,
        bridgeExeExists,
        pythonBin,
        bridgeScript,
        bridgeSrcDir,
        runtimeMode,
        diagnostics,
    };
}

/**
 * Resolve the Steam bridge runtime at startup.
 * Wraps _resolveRuntimePaths with the actual Electron app state.
 */
function resolveSteamRuntimePaths() {
    const app = _getApp();
    const isPackaged = app && app.isPackaged;
    const base = isPackaged ? process.resourcesPath : __dirname;
    return _resolveRuntimePaths(isPackaged, base);
}

/**
 * Return a diagnostics snapshot — safe to call at any time, never throws.
 * Includes selfTestOutput from the most recent runBridgeSelfTest() call, if any.
 */
function diagnoseSteamRuntime() {
    try {
        const { diagnostics } = resolveSteamRuntimePaths();
        return {
            ...diagnostics,
            selfTestOutput: _lastSelfTestResult ? (_lastSelfTestResult.output || _lastSelfTestResult.error || null) : null,
        };
    } catch (e) {
        return { isPackaged: null, runtimeMode: null, error: e.message, selfTestOutput: null };
    }
}

/** Stores the output from the most recent self-test run (used by diagnoseSteamRuntime). */
let _lastSelfTestResult = null;

/**
 * Run baddel_bridge --self-test and return { ok, output?, error? }.
 * Captures both stdout and stderr so missing-module errors are surfaced clearly.
 * Does not require Steam login.
 */
async function runBridgeSelfTest() {
    const { execFile } = require('child_process');
    const { promisify } = require('util');
    const execFileAsync = promisify(execFile);

    try {
        const { bridgeExe, bridgeExeExists, pythonBin, bridgeScript, bridgeSrcDir, runtimeMode } =
            resolveSteamRuntimePaths();

        if (runtimeMode === 'pyinstaller-exe') {
            if (!bridgeExeExists) {
                const r = { ok: false, error: 'baddel_bridge.exe not found.' };
                _lastSelfTestResult = r;
                return r;
            }
            try {
                const { stdout } = await execFileAsync(bridgeExe, ['--self-test'], { timeout: 12_000 });
                const out = stdout.trim();
                const r = out === 'BRIDGE_OK' ? { ok: true } : { ok: false, output: out };
                _lastSelfTestResult = r;
                return r;
            } catch (e) {
                const stdout = typeof e.stdout === 'string' ? e.stdout.trim() : '';
                const stderr = typeof e.stderr === 'string' ? e.stderr.trim() : '';
                const output = [stdout, stderr].filter(Boolean).join('\n') || e.message;
                const r = { ok: false, error: e.message, output };
                _lastSelfTestResult = r;
                return r;
            }
        }

        if (pythonBin && fs.existsSync(bridgeScript)) {
            try {
                const { stdout } = await execFileAsync(
                    pythonBin, [bridgeScript, '--self-test'],
                    { timeout: 20_000, cwd: bridgeSrcDir },
                );
                const out = stdout.trim();
                const r = out === 'BRIDGE_OK' ? { ok: true } : { ok: false, output: out };
                _lastSelfTestResult = r;
                return r;
            } catch (e) {
                const stdout = typeof e.stdout === 'string' ? e.stdout.trim() : '';
                const stderr = typeof e.stderr === 'string' ? e.stderr.trim() : '';
                const output = [stdout, stderr].filter(Boolean).join('\n') || e.message;
                const r = { ok: false, error: e.message, output };
                _lastSelfTestResult = r;
                return r;
            }
        }

        const r = { ok: false, error: 'No runtime available for self-test.' };
        _lastSelfTestResult = r;
        return r;
    } catch (e) {
        const r = { ok: false, error: e.message };
        _lastSelfTestResult = r;
        return r;
    }
}

// ─── Bridge Class ─────────────────────────────────────────────
class SteamBridge extends EventEmitter {
    constructor() {
        super();
        this._proc              = null;
        this._ready             = false;
        this._pendingCalls      = new Map();   // id → { resolve, reject }
        this._nextId            = 1;
        this._buffer            = '';
        this._shutdownRequested = false;
        this._cacheIsReady      = false;       // true once Python fires cache_ready
        /** Steam64 whose cache is currently ready — set from cache_ready event payload */
        this._cacheReadySteamId  = null;
        /** Steam64 of whoever the Python bridge last authenticated as — used for gamesUpdate licensing only */
        this._lastSessionSteamId = null;
    }

    // ── Lifecycle ──────────────────────────────────────────────

    async start() {
        if (this._proc) return; // already running

        await fs.promises.mkdir(path.dirname(_getCacheFile()), { recursive: true });
        this._migrateSteamCredentialKeys();

        // Resolve runtime paths lazily (app.isPackaged is stable by now).
        const { pythonBin, bridgeScript, bridgeSrcDir,
                bridgeExe, bridgeExeDir, bridgeExeExists,
                runtimeMode, diagnostics } = resolveSteamRuntimePaths();

        console.log('[SteamBridge:RUNTIME] Resolved paths:', JSON.stringify(diagnostics));

        if (runtimeMode === 'pyinstaller-exe') {
            if (!bridgeExeExists) {
                const msg = 'Steam runtime is missing from this build. Please reinstall Baddel Launcher.';
                console.error('[SteamBridge:RUNTIME]', msg);
                throw new Error(msg);
            }
            console.log(`[SteamBridge:RUNTIME] mode=packaged-exe bridgeExe=${bridgeExe}`);
            this._proc = spawn(bridgeExe, [], {
                stdio: ['pipe', 'pipe', 'pipe'],
                cwd:   bridgeExeDir,
                env:   { ...process.env, PYTHONUNBUFFERED: '1' },
            });
        } else {
            // python-source (dev) mode
            if (!pythonBin) {
                const msg = 'Steam integration runtime is missing (no Python found). Run scripts/build-python-env.bat or install Python 3.11.';
                console.error('[SteamBridge:RUNTIME]', msg);
                throw new Error(msg);
            }
            if (!fs.existsSync(bridgeScript)) {
                const msg = `Steam integration runtime is missing (bridge script not found: ${bridgeScript}).`;
                console.error('[SteamBridge:RUNTIME]', msg);
                throw new Error(msg);
            }
            // Pre-flight: run --self-test to verify Python dependencies before spawning.
            // This surfaces ModuleNotFoundError (e.g. missing certifi) immediately.
            const selfTest = await runBridgeSelfTest();
            if (!selfTest.ok) {
                const detail = selfTest.output || selfTest.error || 'Unknown error';
                const msg = `Steam bridge self-test failed: ${detail}`;
                console.error('[SteamBridge:RUNTIME] Self-test failed:', detail);
                throw new Error(msg);
            }

            console.log(`[SteamBridge:RUNTIME] mode=python-source python=${pythonBin} script=${bridgeScript}`);
            this._proc = spawn(pythonBin, [bridgeScript], {
                stdio: ['pipe', 'pipe', 'pipe'],
                cwd:   bridgeSrcDir,
                env:   { ...process.env, PYTHONUNBUFFERED: '1', PYTHONPATH: bridgeSrcDir },
            });
        }

        this._proc.stdout.setEncoding('utf8');
        this._proc.stdout.on('data', (chunk) => this._onData(chunk));

        this._proc.stderr.setEncoding('utf8');
        this._proc.stderr.on('data', (chunk) => {
            const QUIET = process.env.BADDEL_QUIET_LOGS === '1';
            chunk.split('\n').filter(Boolean).forEach((line) => {
                // Always-skip noise (regardless of quiet mode)
                const isAlwaysNoise = (
                    line.includes('Got servers from backend') ||
                    line.includes('ClientHeartBeat') ||
                    line.includes('Ignored message') ||
                    line.includes('extended header - ignoring') ||
                    line.includes('EMsg.Multi') ||
                    line.includes('EMsg.ClientServersAvailable') ||
                    line.includes('[In]') ||
                    line.includes('[Out]')
                );
                if (isAlwaysNoise) {
                    this.emit('bridgeLog', { level: 'info', message: line });
                    return;
                }
                // Additional noise suppressed only in quiet mode
                if (QUIET) {
                    const isAuthRelevant = (
                        line.includes('ERROR') ||
                        line.includes('CRITICAL') ||
                        line.includes('Traceback') ||
                        line.includes('AUTH POLL') ||
                        line.includes('Steam login') ||
                        line.includes('authenticate') ||
                        line.includes('QRCode') ||
                        line.includes(' QR ') ||
                        line.includes('2FA') ||
                        line.includes('Steam Guard') ||
                        line.includes('[SteamBridge:AUTH]') ||
                        line.includes('[SteamBridge:RUNTIME]') ||
                        line.includes('[STEAM-LINK-DEBUG]')
                    );
                    const isProtocolNoise = (
                        line.includes('Received user info') ||
                        line.includes('ClientPersonaState') ||
                        line.includes('ClientPICSProductInfoResponse') ||
                        line.includes('Processing message ServiceMethodResponse Player.GetGameAchievements') ||
                        line.includes('Unrecognized app structure') ||
                        line.includes('cache') ||
                        line.includes('library import') ||
                        line.includes('Got mode=')
                    );
                    if (!isAuthRelevant && isProtocolNoise) {
                        this.emit('bridgeLog', { level: 'info', message: line });
                        return;
                    }
                }
                console.log('[STEAM-PY]', redactSecrets(line));
                this.emit('bridgeLog', { level: 'info', message: line });
            });
        });

        this._proc.on('exit', (code, signal) => {
            console.warn(`[SteamBridge] Python process exited: code=${code} signal=${signal}`);
            this._proc         = null;
            this._ready        = false;
            this._cacheIsReady = false;
            this._cacheReadySteamId = null;
            this._rejectAll('Steam bridge process exited unexpectedly');
            if (!this._shutdownRequested) {
                this.emit('disconnected', { code, signal });
            }
        });

        this._proc.on('error', (err) => {
            const isEnoent = err.code === 'ENOENT';
            const msg = isEnoent
                ? `Steam integration runtime is missing (${err.path || pythonBin}). Please reinstall Baddel Launcher.`
                : `Steam bridge process error: ${err.message}`;
            console.error('[SteamBridge:RUNTIME] Spawn error:', msg, 'code:', err.code);
            this._rejectAll(msg);
            this._proc  = null;
            this._ready = false;
            this.emit('error', new Error(msg));
        });

        // Tell the bridge to init and load persistent cache
        const cache = this._loadCache();
        const result = await this._call('start', { persistentCache: cache });
        this._ready = true;
        console.log('[SteamBridge] Bridge ready:', result);
        return result;
    }

    async stop() {
        this._shutdownRequested = true;
        if (this._proc) {
            try { await this._call('shutdown', {}); } catch {}
            this._proc.stdin.end();
            this._proc = null;
        }
        this._ready        = false;
        this._cacheIsReady = false;
        this._cacheReadySteamId = null;
    }

    get isRunning() { return !!this._proc; }

    /** Active CM session Steam ID — do not use for “all linked accounts own this”. */
    getLastSessionSteamId() {
        return this._lastSessionSteamId || this._currentSteamId || null;
    }

    // ── API Methods ────────────────────────────────────────────

    /**
     * Authenticate with stored credentials or start fresh login.
     * Resets the cacheIsReady flag because each authenticate triggers a
     * fresh PICS pipeline on the Python side.
     *
     * Returns:
     *   { status: 'authenticated', steamId, personaName }
     *   { status: 'need_login',    loginUrl, endUriRegex }
     *   { status: 'need_2fa',      method, loginUrl, endUriRegex }
     *   { status: 'error',         message }
     */
    async authenticate(storedCredentials = null, options = {}) {
        this._cacheIsReady = false;
        this._cacheReadySteamId = null;
        const waitForCache = options?.waitForCache === true;
        const cacheTimeoutMs = Number.isFinite(options?.cacheTimeoutMs) ? options.cacheTimeoutMs : 20_000;
        const targetId = storedCredentials?.steamAccountId || storedCredentials?.steam_id_plain || '?';
        console.log(`[SteamBridge:AUTH] ▶ authenticate() called — target=${targetId} waitForCache=${waitForCache}`);

        const cacheReadyPromise = new Promise((resolve) => {
            this.once('cacheReady', resolve);
        });

        const result = await this._call('authenticate', { storedCredentials });
        console.log(`[SteamBridge:AUTH] ◀ authenticate() result — status=${result?.status} steamId=${result?.steamId ?? 'n/a'}`);

        if (result?.status === 'authenticated' && result.steamId != null && result.steamId !== '') {
            this._lastSessionSteamId = String(result.steamId);
            this._currentSteamId = String(result.steamId);
        }

        if (result?.status === 'authenticated' && waitForCache) {
            await Promise.race([
                cacheReadyPromise,
                new Promise((resolve) => setTimeout(resolve, cacheTimeoutMs)),
            ]);
        }

        return result;
    }

    /**
     * Call after the embedded WebView navigates to an end URI.
     * credentials: { end_uri, ...queryParams }
     */
    async passLoginCredentials(endUri, extraParams = {}) {
        const res = await this._call('pass_login_credentials', { end_uri: endUri, ...extraParams });
        
        if (res?.status === 'authenticated' && res.steamId != null && res.steamId !== '') {
            this._currentSteamId = String(res.steamId);
            this._lastSessionSteamId = String(res.steamId);
        }

        return res;
    }

    /**
     * Start a QR-code login session.
     * Returns { status: 'need_qr', challengeUrl, interval }
     */
    async startQrLogin() {
        return this._call('start_qr_login', {});
    }

    /**
     * Start a password-based login.
     * Returns { status: 'need_2fa'|'authenticated'|'need_login', ... }
     */
    async startPasswordLogin(username, password) {
        return this._call('start_password_login', { username, password });
    }

    /**
     * Submit a Steam Guard email or mobile authenticator code.
     * method: 'email' | 'mobile'
     */
    async submitSteamGuardCode(code, method) {
        return this._call('submit_steam_guard_code', { code, method });
    }

    async resendSteamGuardEmail() {
        return this._call('resend_steam_guard_email', {});
    }

    /**
     * Poll for current QR or device-confirmation auth status.
     * Returns { status: 'pending_approval'|'authenticated'|'approval_expired'|'approval_denied' }
     */
    async pollSteamAuth() {
        const res = await this._call('poll_auth_status', {});
        if (res?.status === 'authenticated' && res.steamId != null && res.steamId !== '') {
            this._currentSteamId = String(res.steamId);
            this._lastSessionSteamId = String(res.steamId);
        }
        return res;
    }

    /**
     * Clear the current session and bridge cache.
     */
    async logout() {
        this._cacheIsReady = false;
        this._cacheReadySteamId = null;
        this._currentSteamId = null;
        this._lastSessionSteamId = null;
        return this._call('logout', {});
    }

    /**
     * Returns full owned games list.
     * { status: 'success', games: [{ id, title, appid, platform }] }
     */
    async getOwnedGames(expectedGeneration = null) {
        console.log(`[SteamBridge:GAMES] ▶ getOwnedGames() — cacheReady=${this._cacheIsReady} session=${this._lastSessionSteamId} generation=${expectedGeneration ?? 'any'}`);
        const result = await this._call('get_owned_games', { expectedGeneration });
        const count = Array.isArray(result?.games) ? result.games.length : 0;
        console.log(`[SteamBridge:GAMES] ◀ getOwnedGames() — status=${result?.status} count=${count}`);
        return result;
    }

    async getCollectionStatus() {
        return this._call('get_collection_status', {}, 15_000);
    }

    async recoverCollection(expectedGeneration) {
        return this._call('recover_collection', { expectedGeneration }, 30_000);
    }

    /**
     * Wait for an authoritative account-scoped collection. Inactivity is based
     * only on collection progress revisions; the overall budget stays bounded.
     */
    async waitForCacheReady(targetSteamId, timeoutOrOptions = 35_000) {
        const target = targetSteamId != null ? String(targetSteamId).trim() : '';
        const options = typeof timeoutOrOptions === 'number'
            ? { inactivityMs: timeoutOrOptions }
            : (timeoutOrOptions || {});
        const inactivityMs = Math.max(1, Number(options.inactivityMs) || 60_000);
        const overallMs = Math.max(inactivityMs, Number(options.overallMs) || 10 * 60_000);
        const pollIntervalMs = Math.max(1, Number(options.pollIntervalMs) || 1_000);
        const configuredRecoveryAttempts = Number(options.maxRecoveryAttempts);
        const maxRecoveryAttempts = Number.isFinite(configuredRecoveryAttempts)
            ? Math.max(0, configuredRecoveryAttempts)
            : 2;
        const now = typeof options.now === 'function' ? options.now : Date.now;
        const sleep = typeof options.sleep === 'function'
            ? options.sleep
            : (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const report = typeof options.onProgress === 'function' ? options.onProgress : () => {};

        const startedAt = now();
        let lastProgressAt = startedAt;
        let lastRevision = null;
        let expectedGeneration = Number.isFinite(options.expectedGeneration)
            ? Number(options.expectedGeneration)
            : null;
        let recoveryAttempts = 0;
        let latestSnapshot = null;
        const recoveryHistory = [];
        const readiness = { received: 0, accepted: 0, rejected: 0, lastRejectedReason: null };
        const eventQueue = [];
        const enqueue = (kind) => (data) => eventQueue.push({ kind, data });
        const onReady = enqueue('ready');
        const onIncomplete = enqueue('incomplete');
        this.on('cacheReady', onReady);
        this.on('cacheIncomplete', onIncomplete);

        const fail = (code, message) => {
            const error = new Error(message);
            error.code = code;
            error.completeness = latestSnapshot?.completeness || null;
            error.collectionDiagnostics = { ...latestSnapshot, readiness, recoveryAttempts, recoveryHistory };
            throw error;
        };

        try {
            while (true) {
                while (eventQueue.length) {
                    const event = eventQueue.shift();
                    readiness.received++;
                    const eventAccount = event.data?.steamAccountId != null ? String(event.data.steamAccountId) : '';
                    const eventGeneration = Number(event.data?.sessionGeneration);
                    if ((target && eventAccount && eventAccount !== target)
                        || (expectedGeneration != null && Number.isFinite(eventGeneration) && eventGeneration !== expectedGeneration)) {
                        readiness.rejected++;
                        readiness.lastRejectedReason = target && eventAccount && eventAccount !== target
                            ? 'account_mismatch'
                            : 'generation_mismatch';
                    } else {
                        readiness.accepted++;
                    }
                }

                const snapshot = await this.getCollectionStatus();
                latestSnapshot = snapshot;
                const snapshotAccount = snapshot?.steamAccountId != null ? String(snapshot.steamAccountId) : '';
                const generation = Number(snapshot?.sessionGeneration);
                if (target && snapshotAccount && snapshotAccount !== target) {
                    fail('STEAM_LIBRARY_SESSION_MISMATCH', `Steam collection belongs to a different account than ${target}`);
                }
                if (expectedGeneration == null && Number.isFinite(generation)) expectedGeneration = generation;
                if (expectedGeneration != null && Number.isFinite(generation) && generation < expectedGeneration) {
                    await sleep(pollIntervalMs);
                    continue;
                }
                if (expectedGeneration != null && Number.isFinite(generation) && generation > expectedGeneration) {
                    expectedGeneration = generation;
                    lastRevision = null;
                    lastProgressAt = now();
                }

                const revision = Number(snapshot?.completeness?.progressRevision);
                if (Number.isFinite(revision) && revision !== lastRevision) {
                    lastRevision = revision;
                    lastProgressAt = now();
                }
                const providerAge = Number(snapshot?.completeness?.lastMeaningfulProgressAgeMs);
                if (Number.isFinite(providerAge)) {
                    lastProgressAt = Math.max(lastProgressAt, now() - providerAge);
                }
                report({ ...snapshot, readiness: { ...readiness }, recoveryAttempts, elapsedMs: now() - startedAt });

                if (snapshot?.completeness?.complete === true && snapshot?.completeness?.terminal === true) {
                    this._cacheIsReady = true;
                    this._cacheReadySteamId = snapshotAccount || target || null;
                    return snapshot;
                }

                const elapsed = now() - startedAt;
                if (elapsed >= overallMs) {
                    fail('STEAM_LIBRARY_OVERALL_TIMEOUT', `Steam library collection exceeded the ${overallMs}ms overall budget`);
                }

                const stalled = now() - lastProgressAt >= inactivityMs;
                const terminalIncomplete = snapshot?.completeness?.terminal === true;
                if (stalled || terminalIncomplete) {
                    if (recoveryAttempts >= maxRecoveryAttempts) {
                        fail(
                            terminalIncomplete ? 'STEAM_LIBRARY_INCOMPLETE' : 'STEAM_LIBRARY_INACTIVITY_TIMEOUT',
                            terminalIncomplete
                                ? 'Steam library collection finished with unresolved records after bounded recovery'
                                : `Steam library collection made no meaningful progress for ${inactivityMs}ms after bounded recovery`
                        );
                    }
                    recoveryAttempts++;
                    const recovery = await this.recoverCollection(expectedGeneration);
                    recoveryHistory.push({
                        attemptedAtMs: now() - startedAt,
                        status: recovery?.status || 'unknown',
                        requestedPackageIds: recovery?.requestedPackageIds || [],
                        requestedAppIds: recovery?.requestedAppIds || [],
                        missingLicenseTokenPackageIds: recovery?.missingLicenseTokenPackageIds || [],
                        transport: recovery?.transport || null,
                    });
                    latestSnapshot = recovery?.completeness
                        ? { ...snapshot, completeness: recovery.completeness, recovery }
                        : { ...snapshot, recovery };
                    report({ ...latestSnapshot, readiness: { ...readiness }, recoveryAttempts, elapsedMs: now() - startedAt });
                    await sleep(Math.min(4_000, 500 * (2 ** (recoveryAttempts - 1))));
                    lastProgressAt = now();
                    continue;
                }

                await sleep(Math.min(pollIntervalMs, Math.max(1, overallMs - elapsed)));
            }
        } finally {
            this.off('cacheReady', onReady);
            this.off('cacheIncomplete', onIncomplete);
        }
    }

    /**
     * { status: 'success', friends: [{ userId, username, avatarUrl, profileUrl }] }
     */
    async getFriends() {
        return this._call('get_friends', {});
    }

    /**
     * { status: 'success', achievements: { gameId: [{ name, unlockTime }] } }
     */
    async getAchievements(gameIds = []) {
        // Python path: refresh_game_stats (retries) + wait_ready(60) + wait_metadata_ready(30) can exceed 90s.
        return this._call('get_achievements', { gameIds }, 180_000);
    }

    /**
     * { status: 'success', times: { appid: { timePlayed, lastPlayed } } }
     */
    async getGameTimes() {
        return this._call('get_game_times', {});
    }

    async ping() {
        return this._call('ping', {});
    }

    // ── Internal: JSON-RPC ─────────────────────────────────────

    _call(method, params, timeoutMs = 90_000) {
        return new Promise((resolve, reject) => {
            if (!this._proc) {
                return reject(new Error('Steam bridge is not running'));
            }

            const id = this._nextId++;
            let timer = null;

            timer = setTimeout(() => {
                this._pendingCalls.delete(id);
                try {
                    this._proc?.stdin?.write(JSON.stringify({ id: null, method: 'cancel_request', params: { requestId: id } }) + '\n');
                } catch {}
                const error = new Error(`[SteamBridge] Timeout waiting for "${method}" (${timeoutMs}ms)`);
                error.code = 'STEAM_BRIDGE_REQUEST_TIMEOUT';
                error.requestId = id;
                reject(error);
            }, timeoutMs);

            this._pendingCalls.set(id, {
                resolve: (val) => { clearTimeout(timer); resolve(val); },
                reject:  (err) => { clearTimeout(timer); reject(err); },
            });

            const msg = JSON.stringify({ id, method, params }) + '\n';
            this._proc.stdin.write(msg);
        });
    }

    _onData(chunk) {
        this._buffer += chunk;
        const lines = this._buffer.split('\n');
        this._buffer = lines.pop(); // keep incomplete last line

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
                const msg = JSON.parse(trimmed);
                this._dispatch(msg);
            } catch (e) {
                console.warn('[SteamBridge] Could not parse line:', trimmed.slice(0, 120));
            }
        }
    }

    _dispatch(msg) {
        // Unsolicited event from Python
        if (msg.event) {
            this._onEvent(msg.event, msg.data);
            return;
        }

        // Response to a pending call
        if (msg.id == null) return;
        const pending = this._pendingCalls.get(msg.id);
        if (!pending) {
            console.warn('[SteamBridge] No pending call for id:', msg.id);
            return;
        }
        this._pendingCalls.delete(msg.id);

        if (msg.error) {
            pending.reject(new Error(msg.error));
        } else {
            pending.resolve(msg.result);
        }
    }

    _onEvent(event, data) {
        switch (event) {
            case 'cache_ready':
                // Python finished the PICS pipeline — games are now available.
                // data.steamAccountId identifies whose cache is ready.
                this._cacheIsReady = true;
                this._cacheReadySteamId = data?.steamAccountId ? String(data.steamAccountId).trim() : (this._lastSessionSteamId || null);
                console.log(`[SteamBridge:CACHE] 🎮 cache_ready event received — cacheReadySteamId=${this._cacheReadySteamId}`);
                // Emit the full data payload so account-scoped waitForCacheReady listeners can filter by steamAccountId.
                this.emit('cacheReady', { steamAccountId: this._cacheReadySteamId });
                break;

            case 'cache_incomplete':
                this.emit('cacheIncomplete', data);
                break;

            case 'games_update':
                // New games found in background — emit so UI can update.
                // Payload from Python is { steamAccountId, games } (or legacy raw array).
                this.emit('gamesUpdate', data);
                break;

            case 'presence_update':
                this.emit('presenceUpdate', data);
                break;

            case 'store_credentials': {
                // Python sends encrypted values under "steam_id" — never use that as the map key.
                // steamAccountId is the real decimal Steam64 id (string-safe for JSON).
                const plain =
                    (data?.steamAccountId != null && String(data.steamAccountId).trim() !== '')
                        ? String(data.steamAccountId).trim()
                        : (data?.steam_id_plain != null && String(data.steam_id_plain).trim() !== '')
                            ? String(data.steam_id_plain).trim()
                            : null;
                const maybePlainSteamId = (v) => {
                    const s = v != null ? String(v).trim() : '';
                    return /^\d{10,20}$/.test(s) ? s : null;
                };
                const key = plain || maybePlainSteamId(data?.steam_id) || maybePlainSteamId(data?.steamId);
                if (key) {
                    this._saveCredentialsForAccount(key, data);
                } else {
                    this._saveCredentialsLegacy(data);
                }
                this.emit('credentialsChanged', data);
                break;
            }

            default:
                this.emit(event, data);
        }
    }

    _rejectAll(reason) {
        for (const [id, pending] of this._pendingCalls) {
            pending.reject(new Error(reason));
        }
        this._pendingCalls.clear();
    }

    // ── Persistent Cache ───────────────────────────────────────

    /**
     * Read and decrypt the cache file.
     *
     * Supported formats:
     *   { _wf: 'dpapi-v1', data: '<base64>' }  → whole-file safeStorage encrypted (current)
     *   { _steamCredentialsByAccount: ... }     → legacy plaintext (pre-migration)
     *
     * Returns {} on any failure so callers always get a safe empty object.
     */
    _loadCache() {
        try {
            const raw = fs.readFileSync(_getCacheFile(), 'utf8');
            if (!raw) return {};
            const parsed = JSON.parse(raw);
            if (parsed && parsed._wf === _CACHE_WF_VERSION) {
                const ss = _getSafeStorage();
                if (!ss || !ss.isEncryptionAvailable()) {
                    console.error('[SteamBridge:SECURITY] safeStorage unavailable — cannot decrypt credential cache. Steam accounts require reconnect.');
                    return {};
                }
                try {
                    const buf = Buffer.from(parsed.data, 'base64');
                    return JSON.parse(ss.decryptString(buf));
                } catch (e) {
                    console.error('[SteamBridge:SECURITY] Failed to decrypt credential cache:', e.message, '— Steam accounts require reconnect.');
                    return {};
                }
            }
            // Legacy unencrypted format — returned as-is; migration scheduled at startup
            return parsed || {};
        } catch {
            return {};
        }
    }

    /**
     * Validate, then whole-file encrypt and write the cache.
     *
     * Fails closed:
     *  - If validation detects plaintext credentials → blocked, logged, not written.
     *  - If safeStorage is unavailable → blocked, logged, not written.
     *
     * Returns true on success, false if the write was blocked or failed.
     */
    _writeCache(cache) {
        try {
            // 1. Reject plaintext credentials
            const { ok, reason, badKeys } = validateCacheForWrite(cache);
            if (!ok) {
                const detail = (badKeys || []).map((b) => `${b.steamId}: ${b.reason}`).join('; ') || reason;
                console.error('[SteamBridge:SECURITY] Credential write BLOCKED — plaintext detected:', detail);
                return false;
            }

            // 2. Reject empty cache (prevents truncation)
            const plaintext = JSON.stringify(cache, null, 2);
            if (!plaintext || plaintext === '{}') {
                console.warn('[SteamBridge] Attempted to write empty cache — blocked');
                return false;
            }

            // 3. Whole-file encrypt with safeStorage (DPAPI on Windows)
            const ss = _getSafeStorage();
            if (!ss || !ss.isEncryptionAvailable()) {
                console.error('[SteamBridge:SECURITY] safeStorage unavailable — refusing to write credential cache in plaintext');
                return false;
            }
            const encrypted = ss.encryptString(plaintext);
            const fileContent = JSON.stringify({ _wf: _CACHE_WF_VERSION, data: encrypted.toString('base64') });

            // 4. Atomic write via temp-rename
            const file = _getCacheFile();
            const tmp  = file + '.tmp';
            fs.writeFileSync(tmp, fileContent, 'utf8');
            fs.renameSync(tmp, file);
            return true;
        } catch (e) {
            console.error('[SteamBridge:CREDENTIALS] Failed to write cache:', e.message);
            return false;
        }
    }

    /**
     * Run on startup to:
     *   1. Detect legacy unencrypted cache and upgrade it to safeStorage whole-file encryption.
     *   2. Re-key any credentials stored under encrypted-blob keys to plain Steam64 keys.
     *   3. Delete the cache if plaintext tokens are found (forces reconnect).
     */
    _migrateSteamCredentialKeys() {
        try {
            const cacheFile = _getCacheFile();
            if (!fs.existsSync(cacheFile)) return;

            const raw = fs.readFileSync(cacheFile, 'utf8');
            if (!raw) return;
            const parsed = JSON.parse(raw);

            // Already whole-file encrypted — re-key if needed, then re-write
            if (parsed._wf === _CACHE_WF_VERSION) {
                const cache = this._loadCache();
                if (!cache || !cache._steamCredentialsByAccount) return;
                let changed = false;
                const by = cache._steamCredentialsByAccount;
                for (const key of Object.keys(by)) {
                    if (/^\d{10,20}$/.test(key)) continue;
                    const val = by[key];
                    const rawId = val && (val.steamAccountId ?? val.steam_id_plain);
                    const nk = rawId != null ? String(rawId).trim() : '';
                    if (nk && /^\d{10,20}$/.test(nk)) {
                        if (!by[nk]) by[nk] = { ...val, steamAccountId: nk };
                        else Object.assign(by[nk], val, { steamAccountId: nk });
                        delete by[key];
                        changed = true;
                        console.log('[SteamBridge] Migrated credentials to Steam64 key:', nk);
                    }
                }
                if (changed) this._writeCache(cache);
                return;
            }

            // Legacy unencrypted format — validate before migrating
            const cache = parsed;
            const { ok, badKeys } = validateCacheForWrite(cache);
            if (!ok) {
                const detail = (badKeys || []).map((b) => `${b.steamId}: ${b.reason}`).join('; ');
                console.error('[SteamBridge:SECURITY] Plaintext credentials detected in unencrypted cache:', detail);
                console.error('[SteamBridge:SECURITY] Deleting credential cache. Steam accounts will require reconnect.');
                try { fs.unlinkSync(cacheFile); } catch {}
                return;
            }

            // Re-key legacy blob keys → plain Steam64 keys
            const by = cache._steamCredentialsByAccount || {};
            for (const key of Object.keys(by)) {
                if (/^\d{10,20}$/.test(key)) continue;
                const val = by[key];
                const rawId = val && (val.steamAccountId ?? val.steam_id_plain);
                const nk = rawId != null ? String(rawId).trim() : '';
                if (nk && /^\d{10,20}$/.test(nk)) {
                    if (!by[nk]) by[nk] = { ...val, steamAccountId: nk };
                    else Object.assign(by[nk], val, { steamAccountId: nk });
                    delete by[key];
                    console.log('[SteamBridge] Migrated credentials to Steam64 key:', nk);
                }
            }

            // Upgrade: write with safeStorage encryption
            const wrote = this._writeCache(cache);
            if (wrote) {
                console.log('[SteamBridge] Credential cache upgraded to whole-file encrypted format (safeStorage/DPAPI).');
            }
        } catch (e) {
            if (e.code !== 'ENOENT') {
                console.warn('[SteamBridge] Cache migration skipped:', e.message);
            }
        }
    }

    // ── Multi-account credentials ──────────────────────────────

    /**
     * Save credentials for a specific Steam account.
     * Stored under cache._steamCredentialsByAccount[steamId]
     */
    _saveCredentialsForAccount(steamId, creds) {
        try {
            const cache = this._loadCache();
            if (!cache._steamCredentialsByAccount) cache._steamCredentialsByAccount = {};
            cache._steamCredentialsByAccount[String(steamId)] = creds;
            this._writeCache(cache);
        } catch (e) {
            console.error('[SteamBridge] Failed to save credentials for account:', e.message);
        }
    }

    waitForCredentials(steamId, timeoutMs = 10_000) {
        const wantedId = steamId != null ? String(steamId).trim() : '';
        if (!wantedId) return Promise.resolve(null);

        const existing = this.getCredentialsForAccount(wantedId);
        if (existing) {
            return Promise.resolve(existing);
        }

        return new Promise((resolve) => {
            let settled = false;

            const cleanup = () => {
                clearTimeout(timer);
                this.off('credentialsChanged', onChange);
            };

            const finish = (creds) => {
                if (settled) return;
                settled = true;
                cleanup();
                resolve(creds || null);
            };

            const onChange = (data) => {
                const candidate =
                    data?.steamAccountId ??
                    data?.steam_id_plain ??
                    data?.steamId ??
                    data?.steam_id;
                if (candidate != null && String(candidate).trim() === wantedId) {
                    finish(this.getCredentialsForAccount(wantedId) || data);
                }
            };

            const timer = setTimeout(() => finish(this.getCredentialsForAccount(wantedId)), timeoutMs);

            this.on('credentialsChanged', onChange);
        });
    }

    /** Legacy single-account save — kept for backward compatibility */
    _saveCredentialsLegacy(creds) {
        try {
            const cache = this._loadCache();
            cache._steamCredentials = creds;
            this._writeCache(cache);
        } catch (e) {
            console.error('[SteamBridge] Failed to save credentials (legacy):', e.message);
        }
    }

    /**
     * Retrieve credentials for a specific steamId.
     * Falls back to the legacy single-account field if nothing is found per-account.
     */
    getCredentialsForAccount(steamId) {
        try {
            const cache = this._loadCache();
            const byAccount = cache._steamCredentialsByAccount || {};
            if (byAccount[String(steamId)]) return byAccount[String(steamId)];
            // fallback: legacy single-credential blob
            const legacy = cache._steamCredentials || null;
            if (!legacy) return null;

            const requested = steamId != null ? String(steamId).trim() : '';
            if (!requested) return legacy;

            const legacyId =
                legacy.steamAccountId ??
                legacy.steam_id_plain ??
                legacy.steamId ??
                legacy.steam_id;

            if (legacyId != null && String(legacyId).trim() === requested) {
                return legacy;
            }

            return null;
        } catch {
            return null;
        }
    }

    /**
     * Returns ALL stored per-account credentials as a plain object { steamId: creds }.
     */
    getAllSavedCredentials() {
        try {
            const cache = this._loadCache();
            return cache._steamCredentialsByAccount || {};
        } catch {
            return {};
        }
    }

    /**
     * @deprecated Use getCredentialsForAccount(steamId) instead.
     * Kept for any callers that haven't been updated yet.
     */
    getSavedCredentials() {
        try {
            const cache = this._loadCache();
            // Prefer the first per-account entry if it exists
            const byAccount = cache._steamCredentialsByAccount || {};
            const first = Object.values(byAccount)[0];
            return first || cache._steamCredentials || null;
        } catch {
            return null;
        }
    }

    /**
     * Remove stored credentials for a specific account (called on unlink).
     */
    deleteCredentialsForAccount(steamId) {
        try {
            const cache = this._loadCache();
            if (cache._steamCredentialsByAccount) {
                delete cache._steamCredentialsByAccount[String(steamId)];
            }
            this._writeCache(cache);
        } catch (e) {
            console.error('[SteamBridge] Failed to delete credentials:', e.message);
        }
    }
}

// ─── Singleton ────────────────────────────────────────────────
const bridge = new SteamBridge();

module.exports = bridge;
module.exports.diagnoseSteamRuntime  = diagnoseSteamRuntime;
module.exports.runBridgeSelfTest     = runBridgeSelfTest;
// Exported for unit tests only — not part of the public API.
module.exports._resolveRuntimePaths  = _resolveRuntimePaths;
