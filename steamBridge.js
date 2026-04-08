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

// ─── Paths ───────────────────────────────────────────────────
// app.getPath() only works inside Electron — use a lazy getter
function _getApp() { return require('electron').app; }
function _getCacheFile() {
    return path.join(_getApp().getPath('userData'), 'platform-sync', 'steam_bridge_cache.json');
}

const PYTHON_BIN    = _findPython();
const BRIDGE_SCRIPT = path.join(__dirname, 'baddel-steam-integration', 'src', 'baddel_bridge.py');

function _findPython() {
    const candidates = [
        // Bundled virtualenv (ship this with the app)
        path.join(__dirname, 'python_env', 'Scripts', 'python.exe'),   // Windows
        path.join(__dirname, 'python_env', 'bin', 'python3'),           // macOS/Linux
        // System fallbacks
        'C:\\Users\\seife\\AppData\\Local\\Programs\\Python\\Python311\\python.exe',
        'python',
    ];
    for (const p of candidates) {
        if (!p.includes(path.sep)) return p; // system PATH entry
        if (fs.existsSync(p)) return p;
    }
    return 'python3';
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
        /** Steam64 of whoever the Python bridge last authenticated as — used for gamesUpdate licensing only */
        this._lastSessionSteamId = null;
    }

    // ── Lifecycle ──────────────────────────────────────────────

    async start() {
        if (this._proc) return; // already running

        await fs.promises.mkdir(path.dirname(_getCacheFile()), { recursive: true });
        this._migrateSteamCredentialKeys();

        console.log('[SteamBridge] Starting Python bridge:', PYTHON_BIN, BRIDGE_SCRIPT);

        const BRIDGE_SRC_DIR = path.dirname(BRIDGE_SCRIPT);

        this._proc = spawn(PYTHON_BIN, [BRIDGE_SCRIPT], {
            stdio: ['pipe', 'pipe', 'pipe'],
            cwd: BRIDGE_SRC_DIR,
            env: {
                ...process.env,
                PYTHONUNBUFFERED: '1',
                PYTHONPATH: BRIDGE_SRC_DIR,
            },
        });

        this._proc.stdout.setEncoding('utf8');
        this._proc.stdout.on('data', (chunk) => this._onData(chunk));

        this._proc.stderr.setEncoding('utf8');
        this._proc.stderr.on('data', (chunk) => {
            chunk.split('\n').filter(Boolean).forEach((line) => {
                // Skip high-volume noise: server lists, heartbeats, raw message traces
                const isNoise = (
                    line.includes('Got servers from backend') ||
                    line.includes('ClientHeartBeat') ||
                    line.includes('Ignored message') ||
                    line.includes('extended header - ignoring') ||
                    line.includes('EMsg.Multi') ||
                    line.includes('EMsg.ClientServersAvailable') ||
                    line.includes('[In]') ||
                    line.includes('[Out]')
                );
                if (!isNoise) {
                    console.log('[STEAM-PY]', line);
                }
                this.emit('bridgeLog', { level: 'info', message: line });
            });
        });

        this._proc.on('exit', (code, signal) => {
            console.warn(`[SteamBridge] Python process exited: code=${code} signal=${signal}`);
            this._proc         = null;
            this._ready        = false;
            this._cacheIsReady = false;
            this._rejectAll('Steam bridge process exited unexpectedly');
            if (!this._shutdownRequested) {
                this.emit('disconnected', { code, signal });
            }
        });

        this._proc.on('error', (err) => {
            console.error('[SteamBridge] Spawn error:', err);
            this.emit('error', err);
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
     * Clear the current session and bridge cache.
     */
    async logout() {
        this._cacheIsReady = false;
        this._currentSteamId = null;
        this._lastSessionSteamId = null;
        return this._call('logout', {});
    }

    /**
     * Returns full owned games list.
     * { status: 'success', games: [{ id, title, appid, platform }] }
     */
    async getOwnedGames() {
        console.log(`[SteamBridge:GAMES] ▶ getOwnedGames() — cacheReady=${this._cacheIsReady} session=${this._lastSessionSteamId}`);
        const result = await this._call('get_owned_games', {});
        const count = Array.isArray(result?.games) ? result.games.length : 0;
        console.log(`[SteamBridge:GAMES] ◀ getOwnedGames() — status=${result?.status} count=${count}`);
        return result;
    }

    /**
     * Resolves as soon as the Python games cache signals it is ready
     * (i.e. the PICS pipeline has fully resolved all packages → apps → games).
     *
     * If the cache is already ready (e.g. loaded from disk on the second
     * account in a multi-account sync), this resolves immediately.
     *
     * Always call this between authenticate() and getOwnedGames() to avoid
     * receiving an empty games list.
     *
     * @param {number} timeoutMs  Maximum wait time in ms (default 35s).
     *                            After the timeout we resolve anyway so the
     *                            caller can still try getOwnedGames() and get
     *                            whatever the cache has so far.
     */
    waitForCacheReady(timeoutMs = 35_000) {
        if (this._cacheIsReady) {
            console.log('[SteamBridge:CACHE] Already ready — skipping wait');
            return Promise.resolve();
        }
        console.log(`[SteamBridge:CACHE] ⏳ Waiting for cache (timeout=${timeoutMs}ms) session=${this._lastSessionSteamId}`);
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                console.warn(`[SteamBridge:CACHE] ⚠ TIMED OUT after ${timeoutMs}ms — cacheIsReady=${this._cacheIsReady} — proceeding anyway`);
                resolve();
            }, timeoutMs);

            this.once('cacheReady', () => {
                clearTimeout(timer);
                console.log(`[SteamBridge:CACHE] ✅ Cache ready — session=${this._lastSessionSteamId}`);
                resolve();
            });
        });
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
        return this._call('get_achievements', { gameIds });
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
                reject(new Error(`[SteamBridge] Timeout waiting for "${method}" (${timeoutMs}ms)`));
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
                console.log(`[SteamBridge:CACHE] 🎮 cache_ready event received — session=${this._lastSessionSteamId}`);
                this._cacheIsReady = true;
                this.emit('cacheReady');
                break;

            case 'games_update':
                // New games found in background — emit so UI can update
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

    _loadCache() {
        try {
            return JSON.parse(fs.readFileSync(_getCacheFile(), 'utf8'));
        } catch {
            return {};
        }
    }

    _writeCache(cache) {
        try {
            const content = JSON.stringify(cache, null, 2);
            if (!content || content === '{}') {
                 console.warn('[SteamBridge] Attempted to write empty cache — blocked');
                 return;
            }
            fs.writeFileSync(_getCacheFile(), content, 'utf8');
        } catch (e) {
            console.error('[SteamBridge] Failed to write cache:', e.message);
        }
    }

    /** Old builds saved creds under encrypted steam_id blob as key — re-key to steamAccountId. */
    _migrateSteamCredentialKeys() {
        try {
            const cache = this._loadCache();
            const by = cache._steamCredentialsByAccount;
            if (!by || typeof by !== 'object') return;
            let changed = false;
            for (const key of Object.keys(by)) {
                if (/^\d{10,20}$/.test(key)) continue;
                const val = by[key];
                const raw = val && (val.steamAccountId ?? val.steam_id_plain);
                const nk = raw != null && String(raw).trim() !== '' ? String(raw).trim() : '';
                if (nk && /^\d{10,20}$/.test(nk)) {
                    if (!by[nk]) by[nk] = { ...val, steamAccountId: nk };
                    else Object.assign(by[nk], val, { steamAccountId: nk });
                    delete by[key];
                    changed = true;
                    console.log('[SteamBridge] Migrated credentials to Steam64 key:', nk);
                }
            }
            if (changed) this._writeCache(cache);
        } catch (e) {
            console.warn('[SteamBridge] Credential key migration skipped:', e.message);
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
