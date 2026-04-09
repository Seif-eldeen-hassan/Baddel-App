'use strict';

// ============================================================
// BADDEL LAUNCHER — platformSync.js
// ============================================================

const path        = require('path');
const fs          = require('fs').promises;
const fsSync      = require('fs');
const { execFile, exec } = require('child_process');
const { app, BrowserWindow, ipcMain } = require('electron');
const https = require('https');
const util = require('util');
const execAsync = util.promisify(exec);
const { getLocalSteamGames } = require('./gameScanner');
const { resolveSteamCardImageUrl } = require('./services/steamLibraryAssets');
const {
    orderAccountsForSync,
    countGamesForAccount,
    finalizeLibraryForAccounts,
    removeAccountFromLibrary,
} = require('./platformSyncShared');

// ─── Paths ───────────────────────────────────────────────────
const LEGENDARY_BIN      = path.join(__dirname, 'bin', 'legendary.exe');
const SYNC_CACHE_DIR     = path.join(app.getPath('userData'), 'platform-sync');
const COVERS_DIR         = path.join(SYNC_CACHE_DIR, 'covers');
const SYNC_LOGS_DIR      = path.join(SYNC_CACHE_DIR, 'logs');

// Epic Paths
const EPIC_ACCOUNTS_FILE = path.join(SYNC_CACHE_DIR, 'epic_accounts.json');
const EPIC_MERGED_CACHE  = path.join(SYNC_CACHE_DIR, 'epic_library_merged.json');

// Steam Paths
const STEAM_ACCOUNTS_FILE = path.join(SYNC_CACHE_DIR, 'steam_accounts.json');
const STEAM_MERGED_CACHE  = path.join(SYNC_CACHE_DIR, 'steam_library_merged.json');


// ─── Helpers ─────────────────────────────────────────────────

async function ensureDirs() {
    await fs.mkdir(SYNC_CACHE_DIR, { recursive: true });
    await fs.mkdir(COVERS_DIR, { recursive: true });
    await fs.mkdir(SYNC_LOGS_DIR, { recursive: true });
}

let _platformSyncWindowGetter = null;
const _platformSyncLogWriteQueue = {};
const _coverPrimeQueue = new Map();
const _platformSyncState = {
    steam: null,
    epic: null,
};

function _clonePlain(value) {
    return JSON.parse(JSON.stringify(value));
}

function _createPlatformSyncState(platform) {
    return {
        platform,
        isSyncing: false,
        phase: 'idle',
        statusText: '',
        startedAt: null,
        finishedAt: null,
        progress: {
            completedAccounts: 0,
            totalAccounts: 0,
            percent: 0,
            currentAccountId: null,
            currentAccountName: null,
        },
        accounts: {},
        logs: [],
        lastError: null,
        validation: { ok: true, issues: [], countsByAccount: {}, totalGames: 0 },
        summary: { totalGames: 0, installOnlyGames: 0, sampleTitles: [] },
    };
}

function _getPlatformSyncState(platform) {
    if (!_platformSyncState[platform]) {
        _platformSyncState[platform] = _createPlatformSyncState(platform);
    }
    return _platformSyncState[platform];
}

function _emitPlatformSyncState(platform) {
    try {
        const win = _platformSyncWindowGetter?.();
        if (win && !win.isDestroyed()) {
            win.webContents.send('platform-sync:state', _clonePlain(_getPlatformSyncState(platform)));
        }
    } catch {}
}

function _setPlatformSyncState(platform, updater) {
    const baseState = _clonePlain(_getPlatformSyncState(platform));
    const nextState = typeof updater === 'function'
        ? (updater(baseState) || baseState)
        : { ...baseState, ...updater };
    _platformSyncState[platform] = nextState;
    _emitPlatformSyncState(platform);
    return nextState;
}

function _pushPlatformSyncLog(platform, level, message, extra = {}) {
    const prefix = `[PlatformSync:${platform}]`;
    if (level === 'error') console.error(prefix, message, extra);
    else if (level === 'warn') console.warn(prefix, message, extra);
    else console.log(prefix, message, extra);

    const entry = {
        timestamp: new Date().toISOString(),
        level,
        message,
        accountId: extra.accountId ? String(extra.accountId) : null,
        accountName: extra.accountName || null,
    };

    _setPlatformSyncState(platform, (state) => {
        state.logs = [...(state.logs || []), entry].slice(-80);
        return state;
    });

    const logLine = JSON.stringify(entry) + '\n';
    const currentQueue = _platformSyncLogWriteQueue[platform] || Promise.resolve();
    _platformSyncLogWriteQueue[platform] = currentQueue
        .then(() => ensureDirs())
        .then(() => fs.appendFile(path.join(SYNC_LOGS_DIR, `${platform}.log`), logLine, 'utf8'))
        .catch(() => {});
}

function _startPlatformSync(platform, accounts, statusText) {
    const now = new Date().toISOString();
    const state = _createPlatformSyncState(platform);
    state.isSyncing = true;
    state.phase = 'starting';
    state.statusText = statusText;
    state.startedAt = now;
    state.finishedAt = null;
    state.progress.totalAccounts = accounts.length;
    state.accounts = Object.fromEntries(accounts.map((account) => [
        String(account.id),
        {
            id: String(account.id),
            displayName: account.displayName || String(account.id),
            status: 'pending',
            gamesCount: 0,
            gameTitles: [],
            message: 'Waiting to sync',
            startedAt: null,
            finishedAt: null,
        },
    ]));
    _platformSyncState[platform] = state;
    _emitPlatformSyncState(platform);
    _pushPlatformSyncLog(platform, 'info', statusText);
}

function _updatePlatformSyncAccount(platform, accountId, patch = {}) {
    _setPlatformSyncState(platform, (state) => {
        const aid = String(accountId);
        const existing = state.accounts?.[aid] || { id: aid, displayName: aid, status: 'pending', gamesCount: 0 };
        state.accounts = {
            ...state.accounts,
            [aid]: {
                ...existing,
                ...patch,
            },
        };
        return state;
    });
}

function _updatePlatformSyncProgress(platform, patch = {}) {
    _setPlatformSyncState(platform, (state) => {
        state.progress = { ...state.progress, ...patch };
        const total = Math.max(0, Number(state.progress.totalAccounts) || 0);
        const completed = Math.max(0, Number(state.progress.completedAccounts) || 0);
        state.progress.percent = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
        return state;
    });
}

function _finishPlatformSync(platform, patch = {}) {
    _setPlatformSyncState(platform, (state) => {
        state.isSyncing = false;
        state.phase = patch.phase || 'done';
        state.statusText = patch.statusText || state.statusText;
        state.finishedAt = new Date().toISOString();
        state.lastError = patch.lastError || null;
        if (patch.validation) state.validation = patch.validation;
        if (patch.summary) state.summary = patch.summary;
        if (patch.progress) state.progress = { ...state.progress, ...patch.progress };
        const total = Math.max(0, Number(state.progress.totalAccounts) || 0);
        const completed = Math.max(0, Number(state.progress.completedAccounts) || 0);
        state.progress.percent = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
        return state;
    });
}

async function _writeSwitcherSyncLink(platform, switcherProfileName, platformAccountId, extra = {}) {
    try {
        const switcherDir = path.join(app.getPath('userData'), 'accounts', platform, switcherProfileName.trim());
        await fs.mkdir(switcherDir, { recursive: true });
        const linkFile = path.join(switcherDir, 'sync_link.json');
        await fs.writeFile(linkFile, JSON.stringify({
            platformAccountId: String(platformAccountId),
            linkedAt: new Date().toISOString(),
            ...extra
        }, null, 2), 'utf8');
    } catch (e) {
        console.warn(`[PlatformSync] Could not write sync_link.json for ${platform}/${switcherProfileName}:`, e.message);
    }
}

async function downloadAndCacheCover(url, gameId) {
    if (!url) return null;
    if (!url.startsWith('https')) return url;

    const safeGameId = gameId.replace(/[^a-zA-Z0-9_-]/g, '');
    const destPath = path.join(COVERS_DIR, `${safeGameId}.jpg`);
    const localUrl = `file:///${destPath.replace(/\\/g, '/')}`;

    if (fsSync.existsSync(destPath)) return localUrl;

    try {
        const response = await fetch(url);
        if (!response.ok) return url; 

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        await fs.writeFile(destPath, buffer);
        return localUrl;
    } catch (err) {
        console.error(`[Cover Sync] Error downloading ${gameId}:`, err);
        return url;
    }
}

function _getCachedCoverUrl(gameId) {
    const safeGameId = String(gameId || '').replace(/[^a-zA-Z0-9_-]/g, '');
    if (!safeGameId) return null;
    const destPath = path.join(COVERS_DIR, `${safeGameId}.jpg`);
    if (!fsSync.existsSync(destPath)) return null;
    return `file:///${destPath.replace(/\\/g, '/')}`;
}

function primeCoverDownload(url, gameId) {
    if (!url || !String(url).startsWith('https') || _getCachedCoverUrl(gameId)) {
        return Promise.resolve(_getCachedCoverUrl(gameId) || url || null);
    }
    const queueKey = `${gameId}:${url}`;
    if (_coverPrimeQueue.has(queueKey)) {
        return _coverPrimeQueue.get(queueKey);
    }
    const task = downloadAndCacheCover(url, gameId)
        .catch(() => url)
        .finally(() => {
            _coverPrimeQueue.delete(queueKey);
        });
    _coverPrimeQueue.set(queueKey, task);
    return task;
}

async function resolveCoverUrlForSync(url, gameId) {
    const cachedUrl = _getCachedCoverUrl(gameId);
    if (cachedUrl) return cachedUrl;
    void primeCoverDownload(url, gameId);
    return url || null;
}

async function mapWithConcurrency(items, limit, mapper) {
    const list = Array.isArray(items) ? items : [];
    if (list.length === 0) return [];
    const concurrency = Math.max(1, Math.min(Number(limit) || 1, list.length));
    const results = new Array(list.length);
    let cursor = 0;

    async function worker() {
        while (cursor < list.length) {
            const index = cursor++;
            results[index] = await mapper(list[index], index);
        }
    }

    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    return results;
}

function createFriendlySyncError(platform, err) {
    const rawMessage = String(err?.message || err || 'Unknown error').trim();
    const lower = rawMessage.toLowerCase();

    if (lower.includes('timeout')) {
        return {
            userMessage: platform === 'steam'
                ? 'Steam took too long to reply. We kept the previous library data and saved diagnostics.'
                : 'Epic Games took too long to reply. We kept the previous library data and saved diagnostics.',
            diagnosticMessage: rawMessage,
        };
    }

    if (lower.includes('credentials folder is missing')) {
        return {
            userMessage: 'The saved account data is incomplete. Please relink this account and try again.',
            diagnosticMessage: rawMessage,
        };
    }

    if (lower.includes('not authenticated') || lower.includes('authentication')) {
        return {
            userMessage: 'Authentication did not finish correctly. Please sign in again.',
            diagnosticMessage: rawMessage,
        };
    }

    return {
        userMessage: rawMessage || 'Sync failed. We kept the previous library data.',
        diagnosticMessage: rawMessage || 'Unknown sync error',
    };
}

function mergeOwnedGamesIntoLibrary(mergedLibrary, games, account, platform) {
    const aid = String(account.id);
    for (const game of games) {
        if (mergedLibrary.has(game.id)) {
            const existing = mergedLibrary.get(game.id);
            if (!existing.ownedBy.includes(account.displayName)) existing.ownedBy.push(account.displayName);
            if (!existing.ownedByAccountIds.map(String).includes(aid)) existing.ownedByAccountIds.push(aid);
            if (platform === 'steam') {
                if (!existing.steamLicensedAccountIds) existing.steamLicensedAccountIds = [];
                if (!existing.steamLicensedAccountIds.map(String).includes(aid)) existing.steamLicensedAccountIds.push(aid);
            }
            continue;
        }
        mergedLibrary.set(game.id, game);
    }
}

async function buildSteamOwnedGameEntries(account, games = []) {
    return mapWithConcurrency(games, 10, async (game) => ({
        id: game.id,
        title: game.title,
        platform: 'steam',
        source: 'steam',
        coverUrl: await resolveCoverUrlForSync(
            await resolveSteamCardImageUrl(game.appid, []),
            game.id
        ),
        appName: String(game.appid),
        playtime: 0,
        lastSynced: new Date().toISOString(),
        ownedBy: [account.displayName],
        ownedByAccountIds: [String(account.id)],
        steamLicensedAccountIds: [String(account.id)],
    }));
}

async function buildEpicOwnedGameEntries(account, entries = []) {
    return mapWithConcurrency(entries, 10, async (entry) => {
        const gameId = `epic_${entry.app_name}`;
        return {
            id: gameId,
            title: entry.app_title || entry.app_name,
            platform: 'epic',
            source: 'epic',
            coverUrl: await resolveCoverUrlForSync(_pickEpicCover(entry.metadata?.keyImages), gameId),
            appName: entry.app_name,
            namespace: entry.namespace || entry.metadata?.namespace || '',
            catalogItemId: entry.catalog_item_id || entry.metadata?.id || '',
            lastSynced: new Date().toISOString(),
            ownedBy: [account.displayName],
            ownedByAccountIds: [String(account.id)],
        };
    });
}

function summarizeGameTitles(games, limit = 4) {
    return [...new Set(
        (games || [])
            .map((game) => String(game?.title || '').trim())
            .filter(Boolean)
    )].slice(0, limit);
}

function steamGameBelongsToAccount(game, accountId) {
    const aid = String(accountId);
    if (!game || typeof game !== 'object') return false;

    // Check all arrays - if it's in ANY of them, the account owns it.
    if (Array.isArray(game.steamLicensedAccountIds) && game.steamLicensedAccountIds.map(String).includes(aid)) {
        return true;
    }
    if (Array.isArray(game.ownedByAccountIds) && game.ownedByAccountIds.map(String).includes(aid)) {
        return true;
    }
    if (Array.isArray(game.steamDetectedAccountIds) && game.steamDetectedAccountIds.map(String).includes(aid)) {
        return true;
    }

    return false;
}

async function fetchSteamOwnedGamesWithRetry(account, previousCount, initialSessionSteamId) {
    const aid = String(account.id);
    let result = await steamBridge.getOwnedGames();
    let rawGamesCount = Array.isArray(result?.games) ? result.games.length : 0;
    const shouldRetry = result?.status === 'success' && rawGamesCount === 0;

    if (!shouldRetry) {
        console.log(`[Sync:${account.displayName}] getOwnedGames → ${rawGamesCount} games (no retry needed)`);
        return { result, rawGamesCount };
    }

    console.warn(`[Sync:${account.displayName}] ⚠ getOwnedGames returned 0 — retrying after 1.5s grace period`);
    _pushPlatformSyncLog('steam', 'warn', `Steam returned 0 owned games for ${account.displayName}. Retrying once after the cache settles.`, {
        accountId: aid,
        accountName: account.displayName,
    });
    _updatePlatformSyncAccount('steam', aid, {
        status: 'syncing',
        message: 'Checking your Steam library again',
    });

    // Cache was already awaited before this call — just a short grace period
    await new Promise((resolve) => setTimeout(resolve, 1_500));

    const retryResult = await steamBridge.getOwnedGames();
    const retryCount = Array.isArray(retryResult?.games) ? retryResult.games.length : 0;
    console.log(`[Sync:${account.displayName}] Retry → ${retryCount} games`);

    if (retryResult?.status === 'success' && retryCount > rawGamesCount) {
        _pushPlatformSyncLog('steam', 'info', `Retry recovered ${retryCount} owned games for ${account.displayName}`, {
            accountId: aid,
            accountName: account.displayName,
        });
        result = retryResult;
        rawGamesCount = retryCount;
    } else if (retryResult?.status === 'success' && retryCount === 0) {
        result = retryResult;
        rawGamesCount = 0;
    }

    return { result, rawGamesCount };
}

// ─── Steam Bridge ────────────────────────────────────────────

const steamBridge = require('./steamBridge');

let _bridgeStarted = false;
let _steamBridgeListenersBound = false;
async function _ensureBridgeRunning() {
    if (_bridgeStarted && steamBridge.isRunning) return;
    await steamBridge.start();
    _bridgeStarted = true;

    if (_steamBridgeListenersBound) return;
    _steamBridgeListenersBound = true;

    steamBridge.on('bridgeLog', ({ level, message }) => {
        _pushPlatformSyncLog('steam', level === 'error' ? 'error' : 'info', message);
    });

    steamBridge.on('gamesUpdate', async (newGames) => {
        console.log(`[SteamBridge] 🎮 Background: ${newGames.length} new games discovered`);
        try {
            const existing = JSON.parse(await fs.readFile(STEAM_MERGED_CACHE, 'utf8').catch(() => '[]'));
            const map = new Map(existing.map(g => [g.id, g]));
            const sid = steamBridge.getLastSessionSteamId?.();
            const accs = steamConnector.getAccounts();
            const accMatch = sid ? accs.find((a) => String(a.id) === String(sid)) : null;
            const licensedIds = sid ? [String(sid)] : [];
            const displayNames = accMatch ? [accMatch.displayName] : [];

            for (const g of newGames) {
                if (!map.has(g.id)) {
                    map.set(g.id, {
                        id: g.id,
                        title: g.title,
                        platform: 'steam',
                        source: 'steam',
                        coverUrl: await resolveCoverUrlForSync(
                            await resolveSteamCardImageUrl(g.appid, []),
                            g.id
                        ),
                        appName: String(g.appid),
                        playtime: 0,
                        lastSynced: new Date().toISOString(),
                        ownedBy: displayNames,
                        ownedByAccountIds: licensedIds.length ? [...licensedIds] : [],
                        steamLicensedAccountIds: licensedIds.length ? [...licensedIds] : [],
                        ...(licensedIds.length === 0 ? { installOnly: true } : {}),
                    });
                } else {
                    const ex = map.get(g.id);
                    if (!ex.steamLicensedAccountIds) ex.steamLicensedAccountIds = [];
                    if (sid && !ex.steamLicensedAccountIds.map(String).includes(String(sid))) ex.steamLicensedAccountIds.push(String(sid));
                    if (sid && accMatch) {
                        if (!ex.ownedByAccountIds) ex.ownedByAccountIds = [];
                        if (!ex.ownedByAccountIds.map(String).includes(String(sid))) ex.ownedByAccountIds.push(String(sid));
                        if (!ex.ownedBy) ex.ownedBy = [];
                        if (!ex.ownedBy.includes(accMatch.displayName)) ex.ownedBy.push(accMatch.displayName);
                    }
                }
            }
            await fs.writeFile(STEAM_MERGED_CACHE, JSON.stringify([...map.values()], null, 2), 'utf8');
        } catch (e) {
            console.error('[SteamBridge] Failed to merge background games:', e.message);
        }
    });
}

// ─── Steam Login Window ───────────────────────────────────────
//
// steamId = null  →  أكاونت جديد — لازم نـ force fresh login حتى لو البريدج
//                    authenticated بأكاونت قديم
// steamId = "xxx" →  re-auth لأكاونت موجود باستخدام credentials المحفوظة

async function _openSteamLoginWindow(parentWindow, steamId = null) {
    const { BrowserWindow } = require('electron');

    return new Promise(async (resolve, reject) => {
        await _ensureBridgeRunning();

        let authResult;

        if (steamId) {
            // ─ Re-auth لأكاونت موجود ─────────────────────────
            const storedCreds = steamBridge.getCredentialsForAccount(steamId);
            authResult = await steamBridge.authenticate(storedCreds);

            // لو رجع authenticated بنفس الأكاونت — تمام
            if (authResult.status === 'authenticated') {
                if (String(authResult.steamId) === String(steamId)) {
                    return resolve(authResult);
                }
                // رجع بأكاونت مختلف — نكمّل ونفتح login
                console.warn(`[SteamBridge] Re-auth returned wrong account: ${authResult.steamId} !== ${steamId}`);
            }
        } else {
            try {
                await steamBridge.logout();
            } catch (e) {
                console.warn('[SteamBridge] Fresh-login logout skipped:', e?.message || e);
            }

            authResult = await steamBridge.authenticate(null);
        }

        if (authResult.status === 'error') {
            return reject(new Error(authResult.message));
        }

        // فتح نافذة الـ Login
        const win = new BrowserWindow({
            width: 520,
            height: 700,
            parent: parentWindow || undefined,
            modal: !!parentWindow,
            autoHideMenuBar: true,
            frame: false,
            transparent: true,
            backgroundColor: '#00000000', // Fully transparent to let index.html handle it
            resizable: false,
            show: false, // Don't show until ready-to-show to avoid white flash
            icon: path.join(__dirname, 'assets', 'app_icon.png'),
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                sandbox: false,
                webSecurity: false,
                allowRunningInsecureContent: true,
            },
            title: 'Connect Steam',
        });

        win.setMenuBarVisibility(false);
        win.removeMenu();

        win.once('ready-to-show', () => {
            win.show();
        });

        let currentEndUriRegex = authResult.endUriRegex;
        const applySteamSupportTheme = async () => {
            try {
                await win.webContents.insertCSS(`
                    /* ── Reverting to original Steam design ── */
                    /* We only hide the scrollbar and add style for our custom close arrow */
                    
                    ::-webkit-scrollbar { width: 0px; background: transparent; }
                    * { -ms-overflow-style: none; scrollbar-width: none; }

                    #baddel-close-button {
                        position: fixed !important;
                        top: 20px !important;
                        right: 20px !important;
                        width: 40px !important;
                        height: 40px !important;
                        background: #171d25 !important;
                        border: 1px solid #3d4450 !important;
                        border-radius: 50% !important;
                        display: flex !important;
                        align-items: center !important;
                        justify-content: center !important;
                        cursor: pointer !important;
                        color: #c7d5e0 !important;
                        z-index: 999999 !important;
                        box-shadow: 0 4px 15px rgba(0,0,0,0.5) !important;
                        transition: all 0.2s ease !important;
                    }
                    #baddel-close-button:hover {
                        background: #3d4450 !important;
                        color: #ffffff !important;
                        transform: scale(1.05) !important;
                        border-color: #66c0f4 !important;
                    }
                `);
            } catch {}
        };

        const injectNavigationButtons = async () => {
            try {
                await win.webContents.executeJavaScript(`
                    (function() {
                        if (document.getElementById('baddel-close-button')) return;
                        
                        const btn = document.createElement('div');
                        btn.id = 'baddel-close-button';
                        btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
                        btn.title = 'Close';
                        btn.onclick = () => { window.location.href = 'baddel://close'; };
                        
                        document.body.appendChild(btn);
                    })();
                `);
            } catch {}
        };

        const checkUrl = async (url) => {
            if (!currentEndUriRegex) return;
            const regex = new RegExp(currentEndUriRegex);
            if (!regex.test(url)) return;

            try {
                const urlObj = new URL(url);
                const params = {};
                urlObj.searchParams.forEach((v, k) => { params[k] = v; });

                const result = await steamBridge.passLoginCredentials(url, params);

                if (result.status === 'authenticated') {
                    win.close();
                    resolve(result);
                } else if (result.status === 'need_2fa' || result.status === 'need_login') {
                    currentEndUriRegex = result.endUriRegex;
                    win.loadURL(result.loginUrl);
                } else {
                    win.close();
                    reject(new Error(result.message || 'Steam login failed'));
                }
            } catch (e) {
                win.close();
                reject(e);
            }
        };

        win.webContents.setWindowOpenHandler(({ url }) => {
            if (url.includes('help.steampowered.com')) {
                win.loadURL(url);
                return { action: 'deny' };
            }
            return { action: 'deny' };
        });

        win.webContents.on('will-navigate', (_e, url) => {
            if (url === 'baddel://close') {
                _e.preventDefault();
                win.close();
                return;
            }
            if (url.includes('help.steampowered.com')) {
                return;
            }
            _e.preventDefault();
            checkUrl(url);
        });

        win.webContents.on('did-navigate', (_e, url) => {
            if (url.includes('help.steampowered.com')) {
                applySteamSupportTheme();
                injectNavigationButtons();
                return;
            }
            checkUrl(url);
        });

        win.webContents.on('did-navigate-in-page', (_e, url) => checkUrl(url));
        win.on('closed', () => reject(new Error('Steam login window closed.')));

        try {
            await win.loadURL(authResult.loginUrl);
        } catch (err) {
            console.error('[SteamBridge] Failed to load login URL:', err);
            win.close();
             return reject(new Error('Could not connect to Steam. Please check your internet connection.'));
         }
         // win.webContents.openDevTools({ mode: 'detach' });
     });
 }

// ─── steamConnector ───────────────────────────────────────────

const steamConnector = {
    isLinked() {
        try {
            if (!fsSync.existsSync(STEAM_ACCOUNTS_FILE)) return false;
            return JSON.parse(fsSync.readFileSync(STEAM_ACCOUNTS_FILE, 'utf8')).length > 0;
        } catch { return false; }
    },

    getAccounts() {
        try {
            if (!fsSync.existsSync(STEAM_ACCOUNTS_FILE)) return [];
            const raw = JSON.parse(fsSync.readFileSync(STEAM_ACCOUNTS_FILE, 'utf8'));
            return Array.isArray(raw)
                ? raw.map((a) => ({ ...a, id: String(a.id) }))
                : [];
        } catch { return []; }
    },

    async link(parentWindow) {
        await ensureDirs();
        await _ensureBridgeRunning();

        // فتح login window لأكاونت جديد (steamId = null = force fresh login)
        const authResult = await _openSteamLoginWindow(parentWindow, null);

        if (authResult.status !== 'authenticated') {
            throw new Error('Steam authentication failed');
        }

        const { steamId, personaName } = authResult;
        const displayName = personaName || 'Steam User';
        const steamIdStr = String(steamId);

        try {
            await steamBridge.waitForCredentials(steamIdStr, 10000);
        } catch (e) {
            console.warn(`[SteamBridge] Credentials were not confirmed in cache for ${steamIdStr}:`, e?.message || e);
        }

        let accounts = this.getAccounts();
        const existingIndex = accounts.findIndex(a => String(a.id) === steamIdStr);
        if (existingIndex > -1) {
            accounts[existingIndex].displayName = displayName;
            accounts[existingIndex].id = steamIdStr;
        } else {
            accounts.push({ id: steamIdStr, displayName });
        }

        if (accounts.length === 0) {
             console.error('[PlatformSync] Account list is empty after linking — blocking save');
             throw new Error('Failed to update account list.');
        }

        await fs.writeFile(STEAM_ACCOUNTS_FILE, JSON.stringify(accounts, null, 2), 'utf8');
        await _writeSwitcherSyncLink('steam', displayName, steamIdStr, { steamDisplayName: displayName });

        console.log(`[SteamBridge] ✅ Linked Steam account: ${displayName} (${steamIdStr})`);
        
        // Return BOTH name and ID to allow targeted sync
        return { displayName, steamId: steamIdStr };
    },

    async syncLibrary(targetAccountId = null) {
        await ensureDirs();
        const allAccounts = this.getAccounts();
        if (allAccounts.length === 0) throw new Error('No Steam accounts linked.');

        let accountsToSync = [...allAccounts];
        if (targetAccountId) {
            const target = allAccounts.find(a => String(a.id) === String(targetAccountId));
            if (target) {
                accountsToSync = [target];
            } else {
                console.warn(`[PlatformSync] Target account ${targetAccountId} not found in linked accounts, syncing all.`);
            }
        }

        await _ensureBridgeRunning();

        const initialSessionSteamId = String(steamBridge.getLastSessionSteamId?.() || '');
        const orderedAccounts = orderAccountsForSync(accountsToSync, initialSessionSteamId);
        const previousGames = await this.getCachedLibrary();
        const mergedLibrary = new Map();
        const accountResults = {};
        let completedAccounts = 0;

        _startPlatformSync('steam', orderedAccounts, `Syncing Steam library for ${orderedAccounts.length} account(s)`);

        for (const account of orderedAccounts) {
            _updatePlatformSyncAccount('steam', account.id, {
                gamesCount: countGamesForAccount('steam', previousGames, account.id),
                message: 'Queued for sync',
            });
        }

        try {
            for (const account of orderedAccounts) {
                const aid = String(account.id);
                const previousCount = countGamesForAccount('steam', previousGames, aid);
                _updatePlatformSyncProgress('steam', {
                    completedAccounts,
                    totalAccounts: orderedAccounts.length,
                    currentAccountId: aid,
                    currentAccountName: account.displayName,
                });
                _setPlatformSyncState('steam', (state) => {
                    state.phase = 'sync_account';
                    state.statusText = `Syncing ${account.displayName}`;
                    return state;
                });
                _updatePlatformSyncAccount('steam', aid, {
                    status: 'syncing',
                    startedAt: new Date().toISOString(),
                    finishedAt: null,
                    gamesCount: previousCount,
                    message: 'Authenticating with Steam',
                });
                _pushPlatformSyncLog('steam', 'info', `Authenticating ${account.displayName}`, {
                    accountId: aid,
                    accountName: account.displayName,
                });

                try {
                    let authResult = null;
                    let validationFailed = false;
                    const creds = steamBridge.getCredentialsForAccount(account.id);

                    if (creds) {
                        authResult = await steamBridge.authenticate(creds, { waitForCache: false });
                    } else if (initialSessionSteamId && initialSessionSteamId === aid) {
                        authResult = {
                            status: 'authenticated',
                            steamId: initialSessionSteamId,
                        };
                        _pushPlatformSyncLog('steam', 'warn', `Using active Steam session for ${account.displayName} until credentials are stored`, {
                            accountId: aid,
                            accountName: account.displayName,
                        });
                    } else {
                        accountResults[aid] = { status: 'warning', rawGamesCount: 0, validationFailed: true };
                        _updatePlatformSyncAccount('steam', aid, {
                            status: 'warning',
                            finishedAt: new Date().toISOString(),
                            gamesCount: previousCount,
                            message: 'No saved credentials yet. Cached data will be kept.',
                        });
                        _pushPlatformSyncLog('steam', 'warn', `Skipping ${account.displayName} because no stored credentials were found`, {
                            accountId: aid,
                            accountName: account.displayName,
                        });
                        continue;
                    }

                    if (authResult.status !== 'authenticated') {
                        accountResults[aid] = { status: 'warning', rawGamesCount: 0, validationFailed: true };
                        _updatePlatformSyncAccount('steam', aid, {
                            status: 'warning',
                            finishedAt: new Date().toISOString(),
                            gamesCount: previousCount,
                            message: 'Authentication did not complete. Cached data will be kept.',
                        });
                        _pushPlatformSyncLog('steam', 'warn', `${account.displayName} is not authenticated`, {
                            accountId: aid,
                            accountName: account.displayName,
                        });
                        continue;
                    }

                    if (authResult.steamId && String(authResult.steamId) !== aid) {
                        validationFailed = true;
                        _pushPlatformSyncLog('steam', 'warn', `Steam session mismatch for ${account.displayName}: expected ${aid}, got ${authResult.steamId}`, {
                            accountId: aid,
                            accountName: account.displayName,
                        });
                    }

                    _updatePlatformSyncAccount('steam', aid, {
                        status: 'syncing',
                        message: 'Loading owned games',
                    });

                    // ── DIAGNOSTIC: log cacheIsReady state before waiting ──
                    console.log(`[Sync:${account.displayName}] cacheIsReady=${steamBridge._cacheIsReady} — calling waitForCacheReady(35s)`);
                    await steamBridge.waitForCacheReady(60_000);
                    console.log(`[Sync:${account.displayName}] ✅ waitForCacheReady done — fetching games`);

                    const { result, rawGamesCount } = await fetchSteamOwnedGamesWithRetry(account, previousCount, initialSessionSteamId);
                    if (result.status !== 'success') {
                        accountResults[aid] = { status: 'error', rawGamesCount: 0, validationFailed: true };
                        const friendlyError = createFriendlySyncError('steam', result?.message || 'Failed to load owned games');
                        _updatePlatformSyncAccount('steam', aid, {
                            status: 'error',
                            finishedAt: new Date().toISOString(),
                            gamesCount: previousCount,
                            message: friendlyError.userMessage,
                        });
                        _pushPlatformSyncLog('steam', 'error', `getOwnedGames failed for ${account.displayName}: ${friendlyError.diagnosticMessage}`, {
                            accountId: aid,
                            accountName: account.displayName,
                        });
                        continue;
                    }

                    _pushPlatformSyncLog('steam', 'info', `Fetched ${rawGamesCount} owned games for ${account.displayName}`, {
                        accountId: aid,
                        accountName: account.displayName,
                    });

                    const ownedGames = await buildSteamOwnedGameEntries(account, result.games);
                    mergeOwnedGamesIntoLibrary(mergedLibrary, ownedGames, account, 'steam');

                    const accountStatus = rawGamesCount > 0 ? 'success' : (previousCount > 0 ? 'warning' : 'success');
                    const accountMessage = rawGamesCount > 0
                        ? `Found ${rawGamesCount} owned games`
                        : (previousCount > 0 ? 'Steam returned 0 games. This might be a temporary sync issue, so your previous library data was kept.' : 'No owned games found');

                    accountResults[aid] = {
                        status: accountStatus,
                        rawGamesCount,
                        validationFailed: validationFailed || (rawGamesCount === 0 && previousCount > 0),
                        allowZeroGames: previousCount === 0,
                    };
                    _updatePlatformSyncAccount('steam', aid, {
                        status: accountStatus,
                        finishedAt: new Date().toISOString(),
                        gamesCount: rawGamesCount > 0 ? rawGamesCount : previousCount,
                        gameTitles: summarizeGameTitles(result.games),
                        message: accountMessage,
                    });
                } catch (err) {
                    accountResults[aid] = { status: 'error', rawGamesCount: 0, validationFailed: true };
                    const friendlyError = createFriendlySyncError('steam', err);
                    _updatePlatformSyncAccount('steam', aid, {
                        status: 'error',
                        finishedAt: new Date().toISOString(),
                        gamesCount: previousCount,
                        message: friendlyError.userMessage,
                    });
                    _pushPlatformSyncLog('steam', 'error', `Failed to sync ${account.displayName}: ${friendlyError.diagnosticMessage}`, {
                        accountId: aid,
                        accountName: account.displayName,
                    });
                } finally {
                    completedAccounts += 1;
                    _updatePlatformSyncProgress('steam', {
                        completedAccounts,
                        totalAccounts: orderedAccounts.length,
                        currentAccountId: aid,
                        currentAccountName: account.displayName,
                    });
                }
            }

            _setPlatformSyncState('steam', (state) => {
                state.phase = 'merge_local';
                state.statusText = 'Merging local Steam installs';
                return state;
            });
            _pushPlatformSyncLog('steam', 'info', 'Merging locally installed Steam games');

            const localGames = await getLocalSteamGames().catch((err) => {
                _pushPlatformSyncLog('steam', 'warn', `Failed to read local Steam manifests: ${err.message}`);
                return [];
            });
            let addedFromLocal = 0;

            for (const game of localGames) {
                const gameId = `steam_${game.appid}`;
                if (mergedLibrary.has(gameId)) {
                    const existing = mergedLibrary.get(gameId);
                    if (!existing.steamLicensedAccountIds) existing.steamLicensedAccountIds = [];
                } else {
                    addedFromLocal++;
                    mergedLibrary.set(gameId, {
                        id:                      gameId,
                        title:                   game.name,
                        platform:                'steam',
                        source:                  'steam',
                        coverUrl:                await resolveCoverUrlForSync(
                            await resolveSteamCardImageUrl(game.appid, []),
                            gameId
                        ),
                        appName:                 String(game.appid),
                        playtime:                0,
                        lastSynced:              new Date().toISOString(),
                        ownedBy:                 [],
                        ownedByAccountIds:       [],
                        steamLicensedAccountIds: [],
                        installOnly:             true,
                    });
                }
            }

            const fallbackLocalAccount = orderedAccounts.length === 1
                ? orderedAccounts[0]
                : null;
            const fallbackLocalAccountResult = fallbackLocalAccount
                ? accountResults[String(fallbackLocalAccount.id)]
                : null;

            if (fallbackLocalAccount && fallbackLocalAccountResult?.rawGamesCount === 0 && localGames.length > 0) {
                const fallbackAid = String(fallbackLocalAccount.id);
                let fallbackAttached = 0;

                for (const game of mergedLibrary.values()) {
                    if (!game?.installOnly) continue;
                    if (steamGameBelongsToAccount(game, fallbackAid)) continue;
                    if (!Array.isArray(game.steamDetectedAccountIds)) game.steamDetectedAccountIds = [];
                    if (!game.steamDetectedAccountIds.map(String).includes(fallbackAid)) {
                        game.steamDetectedAccountIds.push(fallbackAid);
                        fallbackAttached += 1;
                    }
                    if (!Array.isArray(game.ownedBy)) game.ownedBy = [];
                    if (!game.ownedBy.includes(fallbackLocalAccount.displayName)) {
                        game.ownedBy.push(fallbackLocalAccount.displayName);
                    }
                }

                if (fallbackAttached > 0) {
                    _pushPlatformSyncLog('steam', 'warn', `Steam reported 0 owned games, so ${fallbackAttached} locally detected games were attached to ${fallbackLocalAccount.displayName}.`, {
                        accountId: fallbackAid,
                        accountName: fallbackLocalAccount.displayName,
                    });
                }
            }

            const finalized = finalizeLibraryForAccounts({
                platform: 'steam',
                previousGames,
                nextGames: Array.from(mergedLibrary.values()),
                accounts: allAccounts,
                accountResults,
            });
            const finalGames = finalized.games;
            const summary = {
                totalGames: finalGames.length,
                installOnlyGames: finalGames.filter((game) => game.installOnly).length,
                sampleTitles: summarizeGameTitles(finalGames, 5),
            };

            for (const account of allAccounts) {
                const aid = String(account.id);
                const existingState = _getPlatformSyncState('steam').accounts?.[aid] || {};
                const accountGames = finalGames.filter((game) => steamGameBelongsToAccount(game, aid));
                _updatePlatformSyncAccount('steam', aid, {
                    gamesCount: finalized.validation.countsByAccount?.[aid] ?? existingState.gamesCount ?? 0,
                    gameTitles: summarizeGameTitles(accountGames),
                });
            }

            for (const issue of finalized.validation.issues || []) {
                _pushPlatformSyncLog('steam', 'warn', issue);
            }

            await fs.writeFile(STEAM_MERGED_CACHE, JSON.stringify(finalGames, null, 2), 'utf8');

            _updatePlatformSyncProgress('steam', {
                completedAccounts: orderedAccounts.length,
                totalAccounts: orderedAccounts.length,
                currentAccountId: null,
                currentAccountName: null,
            });
            _finishPlatformSync('steam', {
                phase: 'done',
                statusText: finalized.validation.issues.length > 0
                    ? `Steam sync completed with recovery checks. ${finalGames.length} games ready.`
                    : `Steam sync completed. ${finalGames.length} games ready.`,
                validation: finalized.validation,
                summary,
            });
            _pushPlatformSyncLog('steam', 'info', `Steam sync finished with ${finalGames.length} games and ${addedFromLocal} local-only additions`);
            return finalGames;
        } catch (err) {
            _finishPlatformSync('steam', {
                phase: 'error',
                statusText: `Steam sync failed: ${err.message}`,
                lastError: err.message,
            });
            _pushPlatformSyncLog('steam', 'error', `Steam sync crashed: ${err.message}`);
            throw err;
        }
    },

    async getCachedLibrary() {
        try { return JSON.parse(await fs.readFile(STEAM_MERGED_CACHE, 'utf8')); }
        catch { return []; }
    },

    async unlink(accountId) {
        let accounts = this.getAccounts();
        const removedAccount = accountId
            ? accounts.find((account) => String(account.id) === String(accountId)) || null
            : null;

        if (accountId) {
            accounts = accounts.filter(a => a.id !== accountId);
            steamBridge.deleteCredentialsForAccount(accountId);
        } else {
            for (const acc of accounts) steamBridge.deleteCredentialsForAccount(acc.id);
            accounts = [];
        }

        await fs.writeFile(STEAM_ACCOUNTS_FILE, JSON.stringify(accounts, null, 2), 'utf8');

        if (accounts.length === 0) {
            try { await fs.unlink(STEAM_MERGED_CACHE); } catch {}
            if (steamBridge.isRunning) await steamBridge.stop();
            _bridgeStarted = false;
        } else if (removedAccount) {
            const cachedGames = await this.getCachedLibrary();
            const filteredGames = removeAccountFromLibrary('steam', cachedGames, removedAccount);
            await fs.writeFile(STEAM_MERGED_CACHE, JSON.stringify(filteredGames, null, 2), 'utf8');
        }
    },
};


// ============================================================
// ─── EPIC CONNECTOR ─────────────────────────────────────────
// ============================================================

function getLegendaryConfPath(accountId) {
    return path.join(app.getPath('userData'), `legendary-config-${accountId}`);
}

async function getEpicAccountsList() {
    try { return JSON.parse(await fs.readFile(EPIC_ACCOUNTS_FILE, 'utf8')); } 
    catch { return []; }
}

async function saveEpicAccountsList(accounts) {
    await ensureDirs();
    await fs.writeFile(EPIC_ACCOUNTS_FILE, JSON.stringify(accounts, null, 2), 'utf8');
}

function runLegendary(args, configPath, timeoutMs = 45_000) {
    return new Promise((resolve, reject) => {
        if (!fsSync.existsSync(LEGENDARY_BIN)) {
            return reject(new Error(`legendary.exe not found at ${LEGENDARY_BIN}`));
        }

        const env = { ...process.env, LEGENDARY_CONFIG_PATH: configPath };
        const proc = execFile(LEGENDARY_BIN, args, { env, timeout: timeoutMs, maxBuffer: 1024 * 1024 * 50 });

        let out = '', err = '';
        proc.stdout?.on('data', (data) => { out += data; });
        proc.stderr?.on('data', (data) => { err += data; });

        proc.on('close', (code, signal) => {
            if (code === 0) {
                resolve(out);
                return;
            }
            const stderrText = String(err || '').trim();
            const stdoutText = String(out || '').trim();
            const detail = stderrText || stdoutText || (signal ? `legendary terminated with signal ${signal}` : `legendary exited with code ${code}`);
            reject(new Error(detail));
        });
        proc.on('error', (err) => reject(new Error(err?.message || 'Failed to start legendary.exe')));
    });
}

function openEpicLoginWindow(parentWindow) {
    return new Promise((resolve, reject) => {
        let codeFound = false;

        const win = new BrowserWindow({
            width: 480, height: 660, parent: parentWindow || undefined, modal: !!parentWindow,
            frame: false, backgroundColor: '#121212', 
            webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
            title: 'Connect Epic Games',
        });

        const customUserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

        win.webContents.on('did-finish-load', () => {
            win.webContents.insertCSS(`
                #nav-logo-con, .site-navbar, footer { display: none !important; }
            `).catch(()=>{});

            win.webContents.executeJavaScript(`
                if (!document.getElementById('baddel-close-btn')) {
                    const btn = document.createElement('div');
                    btn.id = 'baddel-close-btn';
                    btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
                    btn.style.cssText = 'position:fixed; top:12px; right:12px; width:32px; height:32px; background:rgba(255,255,255,0.1); border-radius:50%; display:flex; align-items:center; justify-content:center; cursor:pointer; z-index:999999; transition:0.2s;';
                    btn.onmouseover = () => btn.style.background = 'rgba(255,255,255,0.2)';
                    btn.onmouseout = () => btn.style.background = 'rgba(255,255,255,0.1)';
                    btn.onclick = () => window.close();
                    document.body.appendChild(btn);
                    
                    const drag = document.createElement('div');
                    drag.style.cssText = 'position:fixed; top:0; left:0; right:50px; height:40px; -webkit-app-region: drag; z-index:999998;';
                    document.body.appendChild(drag);
                }
            `).catch(()=>{});
        });

        const LOGIN_URL = `https://www.epicgames.com/id/login?redirectUrl=${encodeURIComponent(`https://www.epicgames.com/id/api/redirect?clientId=34a02cf8f4414e29b15921876da36f9a&responseType=code`)}`;
        
        win.webContents.session.clearStorageData().then(() => win.loadURL(LOGIN_URL, { userAgent: customUserAgent }));
        
        win.webContents.on('did-navigate', async (_e, url) => {
            if (!url.includes('/id/api/redirect')) return;
            try {
                const bodyText = await win.webContents.executeJavaScript('document.body.innerText');
                const data = JSON.parse(bodyText);
                if (data?.authorizationCode) {
                    codeFound = true;
                    win.close();
                    resolve(data.authorizationCode);
                }
            } catch { /* wait */ }
        });

        win.on('closed', () => { if (!codeFound) reject(new Error('Epic login cancelled.')); });
    });
}

function _pickEpicCover(keyImages) {
    if (!Array.isArray(keyImages) || keyImages.length === 0) return null;
    const PREF = ['DieselGameBoxTall', 'DieselGameBox', 'OfferImageTall', 'Thumbnail'];
    for (const type of PREF) {
        const img = keyImages.find(k => k.type === type);
        if (img?.url) return img.url;
    }
    return keyImages[0]?.url || null;
}

async function syncSingleEpicAccount(acc, previousGames, targetAccountId = null) {
    if (targetAccountId && String(acc.id) !== String(targetAccountId)) {
        return { status: 'skipped' };
    }
    const aid = String(acc.id);
    const previousCount = countGamesForAccount('epic', previousGames, aid);

    _setPlatformSyncState('epic', (state) => {
        state.phase = 'sync_account';
        state.statusText = `Syncing ${acc.displayName}`;
        return state;
    });
    _updatePlatformSyncAccount('epic', aid, {
        status: 'syncing',
        startedAt: new Date().toISOString(),
        finishedAt: null,
        gamesCount: previousCount,
        message: 'Reading Epic library',
    });
    _pushPlatformSyncLog('epic', 'info', `Reading Epic library for ${acc.displayName}`, {
        accountId: aid,
        accountName: acc.displayName,
    });

    try {
        const confPath = getLegendaryConfPath(acc.id);
        if (!fsSync.existsSync(confPath)) {
            _pushPlatformSyncLog('epic', 'warn', `Skipping ${acc.displayName} because its config folder is missing`, {
                accountId: aid,
                accountName: acc.displayName,
            });
            _updatePlatformSyncAccount('epic', aid, {
                status: 'warning',
                finishedAt: new Date().toISOString(),
                gamesCount: previousCount,
                message: 'The saved Epic login is missing. Relink this account to sync again.',
            });
            return {
                aid,
                games: [],
                result: { status: 'warning', rawGamesCount: 0, validationFailed: true },
            };
        }

        _pushPlatformSyncLog('epic', 'info', `Running legendary list for ${acc.displayName}`, {
            accountId: aid,
            accountName: acc.displayName,
        });

        const raw = await runLegendary(['list', '--json'], confPath, 30_000);
        const parsed = JSON.parse(raw);
        const games = await buildEpicOwnedGameEntries(acc, parsed);
        const rawGamesCount = Array.isArray(parsed) ? parsed.length : 0;
        const result = {
            status: rawGamesCount > 0 ? 'success' : (previousCount > 0 ? 'warning' : 'success'),
            rawGamesCount,
            validationFailed: rawGamesCount === 0 && previousCount > 0,
            allowZeroGames: previousCount === 0,
        };

        _updatePlatformSyncAccount('epic', aid, {
            status: result.status,
            finishedAt: new Date().toISOString(),
            gamesCount: rawGamesCount > 0 ? rawGamesCount : previousCount,
            message: rawGamesCount > 0
                ? `Found ${rawGamesCount} owned games`
                : (previousCount > 0 ? 'Epic returned 0 games. Cached data will be verified.' : 'No owned games found'),
        });
        _pushPlatformSyncLog('epic', 'info', `Fetched ${rawGamesCount} games for ${acc.displayName}`, {
            accountId: aid,
            accountName: acc.displayName,
        });

        return { aid, games, result };
    } catch (err) {
        const friendlyError = createFriendlySyncError('epic', err);
        _updatePlatformSyncAccount('epic', aid, {
            status: 'error',
            finishedAt: new Date().toISOString(),
            gamesCount: previousCount,
            message: friendlyError.userMessage,
        });
        _pushPlatformSyncLog('epic', 'error', `Failed to sync ${acc.displayName}: ${friendlyError.diagnosticMessage}`, {
            accountId: aid,
            accountName: acc.displayName,
        });
        return {
            aid,
            games: [],
            result: { status: 'error', rawGamesCount: 0, validationFailed: true },
        };
    }
}

const epicConnector = {
    isLinked() {
        try { return fsSync.existsSync(EPIC_ACCOUNTS_FILE) && JSON.parse(fsSync.readFileSync(EPIC_ACCOUNTS_FILE, 'utf8')).length > 0; } 
        catch { return false; }
    },
    getAccounts() {
        try { return fsSync.existsSync(EPIC_ACCOUNTS_FILE) ? JSON.parse(fsSync.readFileSync(EPIC_ACCOUNTS_FILE, 'utf8')) : []; } 
        catch { return []; }
    },
    async link(parentWindow) {
        await ensureDirs();
        const authCode = await openEpicLoginWindow(parentWindow);
        const tmpId = `epic_tmp_${Date.now()}`;
        const confPath = getLegendaryConfPath(tmpId);
        await fs.mkdir(confPath, { recursive: true });
        try {
            await runLegendary(['auth', '--code', authCode], confPath);
            const raw = await runLegendary(['status', '--json'], confPath);
            const status = JSON.parse(raw);
            const accountId   = status.account_id   || status.user?.account_id   || tmpId;
            const displayName = status.display_name  || status.user?.display_name || 'Epic User';
            const realConfPath = getLegendaryConfPath(accountId);
            if (confPath !== realConfPath) {
                await fs.rename(confPath, realConfPath).catch(async () => {
                    await fs.cp(confPath, realConfPath, { recursive: true });
                    await fs.rm(confPath, { recursive: true, force: true });
                });
            }
            let accounts = await getEpicAccountsList();
            if (!accounts.find(a => a.id === accountId)) {
                accounts.push({ id: accountId, displayName });
                await saveEpicAccountsList(accounts);
            }
            await _writeSwitcherSyncLink('epic', displayName, accountId, { epicDisplayName: displayName });
            return displayName;
        } catch (err) {
            await fs.rm(confPath, { recursive: true, force: true }).catch(()=>{});
            throw err;
        }
    },
    async syncLibrary(targetAccountId = null) {
        await ensureDirs();
        const accounts = await getEpicAccountsList();
        if (accounts.length === 0) throw new Error('No Epic accounts linked.');

        const previousGames = await this.getCachedLibrary();
        const mergedLibrary = new Map();
        const accountResults = {};
        let completedAccounts = 0;

        // If targeting a specific account, filter the list
        const accountsToSync = targetAccountId 
            ? accounts.filter(a => String(a.id) === String(targetAccountId))
            : accounts;

        if (accountsToSync.length === 0 && targetAccountId) {
            console.warn(`[EpicSync] Target account ${targetAccountId} not found.`);
        }

        _startPlatformSync('epic', accountsToSync, `Syncing Epic library for ${accountsToSync.length} account(s)`);

        for (const account of accountsToSync) {
            _updatePlatformSyncAccount('epic', account.id, {
                gamesCount: countGamesForAccount('epic', previousGames, account.id),
                message: 'Queued for sync',
            });
        }

        try {
            const syncResults = await mapWithConcurrency(accountsToSync, 2, async (acc) => {
                _updatePlatformSyncProgress('epic', {
                    completedAccounts,
                    totalAccounts: accountsToSync.length,
                    currentAccountId: String(acc.id),
                    currentAccountName: acc.displayName,
                });
                const result = await syncSingleEpicAccount(acc, previousGames, targetAccountId);
                if (result.status === 'skipped') return null;

                completedAccounts += 1;
                _updatePlatformSyncProgress('epic', {
                    completedAccounts,
                    totalAccounts: accountsToSync.length,
                    currentAccountId: String(acc.id),
                    currentAccountName: acc.displayName,
                });
                return { account: acc, ...result };
            });

            for (const item of syncResults) {
                if (!item) continue;
                accountResults[item.aid] = item.result;
                mergeOwnedGamesIntoLibrary(mergedLibrary, item.games, item.account, 'epic');
            }

            // If we are doing a partial sync, we MUST preserve the games from other accounts
            // that were NOT part of this sync session.
            if (targetAccountId) {
                for (const prevGame of previousGames) {
                    const isFromTarget = prevGame.ownedByAccountIds && prevGame.ownedByAccountIds.some(id => String(id) === String(targetAccountId));
                    if (!isFromTarget) {
                        const gid = prevGame.id;
                        if (!mergedLibrary.has(gid)) {
                            mergedLibrary.set(gid, prevGame);
                        }
                    }
                }
            }

            const finalized = finalizeLibraryForAccounts({
                platform: 'epic',
                previousGames,
                nextGames: Array.from(mergedLibrary.values()),
                accounts: accountsToSync,
                accountResults,
            });
            const finalGames = finalized.games;

            for (const acc of accountsToSync) {
                const aid = String(acc.id);
                const existingState = _getPlatformSyncState('epic').accounts?.[aid] || {};
                _updatePlatformSyncAccount('epic', aid, {
                    gamesCount: finalized.validation.countsByAccount?.[aid] ?? existingState.gamesCount ?? 0,
                });
            }

            for (const issue of finalized.validation.issues || []) {
                _pushPlatformSyncLog('epic', 'warn', issue);
            }

            await fs.writeFile(EPIC_MERGED_CACHE, JSON.stringify(finalGames, null, 2), 'utf8');
            _updatePlatformSyncProgress('epic', {
                completedAccounts: accountsToSync.length,
                totalAccounts: accountsToSync.length,
                currentAccountId: null,
                currentAccountName: null,
            });
            _finishPlatformSync('epic', {
                phase: 'done',
                statusText: finalized.validation.issues.length > 0
                    ? `Epic sync completed with recovery checks. ${finalGames.length} games ready.`
                    : `Epic sync completed. ${finalGames.length} games ready.`,
                validation: finalized.validation,
                summary: {
                    totalGames: finalGames.length,
                    installOnlyGames: 0,
                },
            });
            return finalGames;
        } catch (err) {
            _finishPlatformSync('epic', {
                phase: 'error',
                statusText: `Epic sync failed: ${err.message}`,
                lastError: err.message,
            });
            _pushPlatformSyncLog('epic', 'error', `Epic sync crashed: ${err.message}`);
            throw err;
        }
    },
    async getCachedLibrary() {
        try { return JSON.parse(await fs.readFile(EPIC_MERGED_CACHE, 'utf8')); } 
        catch { return []; }
    },
    async unlink(accountId) {
        let accounts = await getEpicAccountsList();
        const removedAccount = accountId
            ? accounts.find((account) => String(account.id) === String(accountId)) || null
            : null;
        if (accountId) {
            const confPath = getLegendaryConfPath(accountId);
            try { await runLegendary(['auth', '--delete'], confPath); } catch {}
            await fs.rm(confPath, { recursive: true, force: true }).catch(()=>{});
            accounts = accounts.filter(a => a.id !== accountId);
        } else {
            for (const acc of accounts) {
                const confPath = getLegendaryConfPath(acc.id);
                try { await runLegendary(['auth', '--delete'], confPath); } catch {}
                await fs.rm(confPath, { recursive: true, force: true }).catch(()=>{});
            }
            accounts = [];
        }
        await saveEpicAccountsList(accounts);
        if (accounts.length === 0) {
            try { await fs.unlink(EPIC_MERGED_CACHE); } catch {}
        } else if (removedAccount) {
            const cachedGames = await this.getCachedLibrary();
            const filteredGames = removeAccountFromLibrary('epic', cachedGames, removedAccount);
            await fs.writeFile(EPIC_MERGED_CACHE, JSON.stringify(filteredGames, null, 2), 'utf8');
        }
    },
};

// ─── IPC Handler Registry ────────────────────────────────────

function registerPlatformSyncHandlers(ipcMainRef, getMainWindow) {
    _platformSyncWindowGetter = getMainWindow;
    const connectors = {
        epic: epicConnector,
        steam: steamConnector 
    };

    function safeHandle(fn) {
        return async (...args) => {
            try { return await fn(...args); } 
            catch (err) {
                console.error('[PlatformSync] IPC error:', err);
                return { status: 'error', message: err?.message || 'Unknown error.' };
            }
        };
    }

    ipcMainRef.handle('platform-sync:status', safeHandle(async () => {
        return Object.fromEntries(Object.entries(connectors).map(([k, v]) => [k, v.isLinked()]));
    }));

    ipcMainRef.handle('platform-sync:get-accounts', safeHandle(async (_e, platform) => {
        const connector = connectors[platform];
        if (!connector || !connector.getAccounts) return { status: 'success', accounts: [] };
        return { status: 'success', accounts: connector.getAccounts() };
    }));

    ipcMainRef.handle('platform-sync:link', safeHandle(async (_e, platform) => {
        const connector = connectors[platform];
        if (!connector) throw new Error(`Unsupported platform: ${platform}`);
        console.log(`[PlatformSync] Linking platform: ${platform}`);
        const linkRes = await connector.link(getMainWindow?.());
        return { status: 'success', ...linkRes };
    }));

    ipcMainRef.handle('platform-sync:sync', safeHandle(async (_e, platform, accountId) => {
        const connector = connectors[platform];
        if (!connector) throw new Error(`Unsupported platform: ${platform}`);
        const games = await connector.syncLibrary(accountId);
        return { status: 'success', games };
    }));

    ipcMainRef.handle('platform-sync:get-state', safeHandle(async (_e, platform) => {
        if (!platform) return { status: 'success', state: _clonePlain(_platformSyncState) };
        return { status: 'success', state: _clonePlain(_getPlatformSyncState(platform)) };
    }));

    ipcMainRef.handle('platform-sync:get-cached', safeHandle(async (_e, platform) => {
        const connector = connectors[platform];
        if (!connector) throw new Error(`Unsupported platform: ${platform}`);
        const games = await connector.getCachedLibrary?.() ?? [];
        return { status: 'success', games };
    }));

    ipcMainRef.handle('platform-sync:unlink', safeHandle(async (_e, platform, accountId) => {
        const connector = connectors[platform];
        if (!connector) throw new Error(`Unsupported platform: ${platform}`);
        await connector.unlink(accountId);
        return { status: 'success' };
    }));
}

// ─── Data Enrichment Helper ───────────────────────────────────

const ALL_CONNECTORS = {
    epic: epicConnector,
    steam: steamConnector 
};

async function enrichProfilesWithSyncData(platform, switcherProfiles) {
    const connector = ALL_CONNECTORS[platform];

    const normalized = switcherProfiles.map(p => {
        if (typeof p === 'string') return { name: p, username: p, displayName: p, id: p };
        return { name: p.name || p.username || p.displayName || String(p.id || ''), ...p };
    });

    if (!connector || !connector.getCachedLibrary || !connector.getAccounts) {
        return normalized.map(p => ({ ...p, isSynced: false, ownedGames: [] }));
    }

    try {
        const syncedAccounts = await connector.getAccounts();
        const library = await connector.getCachedLibrary();

        return normalized.map(profile => {
            const realId = profile.platformAccountId ? String(profile.platformAccountId) : String(profile.id || profile.accountId || profile.username || profile.name);
            const isSynced = syncedAccounts.some(sa => String(sa.id) === realId);
            const ownedGames = library.filter((g) => {
                if (platform === 'steam') {
                    return steamGameBelongsToAccount(g, realId);
                }
                return g.ownedByAccountIds && g.ownedByAccountIds.some((id) => String(id) === realId);
            }).map((g) => g.title);

            return { ...profile, isSynced, ownedGames, _resolvedSyncId: realId };
        });
    } catch (e) {
        console.error(`[PlatformSync] Error enriching profiles for ${platform}:`, e);
        return normalized;
    }
}

// ─── Exports ─────────────────────────────────────────────────

module.exports = {
    registerPlatformSyncHandlers,
    epicConnector,
    steamConnector,
    enrichProfilesWithSyncData 
};
