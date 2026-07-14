'use strict';

// ============================================================
// BADDEL LAUNCHER — platformSync.js
// ============================================================

const path        = require('path');
const fs          = require('fs').promises;
const fsSync      = require('fs');
const { execFile } = require('child_process');
const { app, BrowserWindow, Notification } = require('electron');
const { getGamesFeature } = require('./src/features/games/infrastructure/composition/GamesContainer');
const { GamesSyncAdapter } = require('./src/features/sync/infrastructure/adapters/GamesSyncAdapter');
const {
    orderAccountsForSync,
    countGamesForAccount,
    finalizeLibraryForAccounts,
    removeAccountFromLibrary,
    computeSteamSyncMessage,
    computeTerminalAccountStatus,
    TRANSIENT_SYNC_STATUSES,
    isEpicPlayableGameEntry,
    isEpicSyncedGameAllowed,
    classifyEpicEntry,
    resolveEpicAccountIdentity,
} = require('./platformSyncShared');
const {
    createFriendlySyncError,
    mergeExistingEpicOwnership,
    mergeOwnedGamesIntoLibrary,
    summarizeEpicEntryForLog,
    summarizeGameTitles,
    steamGameBelongsToAccount,
} = require('./src/features/sync/domain/services/syncLibraryRules');
const {
    createConnectorRepositoryBundle,
} = require('./src/features/sync/infrastructure/composition/ConnectorRepositoryBundle');
const {
    PollSteamApprovalUseCase,
} = require('./src/features/sync/application/useCases/PollSteamApprovalUseCase');
const {
    createSteamQrPollingLoop,
} = require('./src/features/sync/application/services/SteamQrPollingLoop');
const {
    PlatformSyncAssetWriteBackService,
} = require('./src/features/sync/application/services/PlatformSyncAssetWriteBackService');
const {
    PlatformSyncServerImportService,
} = require('./src/features/sync/application/services/PlatformSyncServerImportService');
const {
    SyncLogQueue,
} = require('./src/features/sync/infrastructure/runtime/SyncLogQueue');
const {
    LinkStateEmitter,
} = require('./src/features/sync/infrastructure/runtime/LinkStateEmitter');
const {
    LibraryUpdateEmitter,
} = require('./src/features/sync/infrastructure/runtime/LibraryUpdateEmitter');
const {
    SyncTerminalEventEmitter,
} = require('./src/features/sync/infrastructure/runtime/SyncTerminalEventEmitter');
const {
    StateChangedEmitter,
} = require('./src/features/sync/infrastructure/runtime/StateChangedEmitter');
const {
    createPlatformSyncFeature,
} = require('./src/features/sync/infrastructure/composition/createPlatformSyncFeature');
const baddelApi = require('./services/baddelApi');
const { redactSecrets } = require('./services/credentialValidator');
const analytics = require('./analytics');

// ─── Dev/debug logging gates ─────────────────────────────────
const QUIET_LOGS      = process.env.BADDEL_QUIET_LOGS      === '1';
const STEAM_AUTH_DEBUG = process.env.BADDEL_STEAM_AUTH_DEBUG === '1';

function syncLog(...args)  { if (!QUIET_LOGS) console.log(...args); }
function syncWarn(...args) { if (!QUIET_LOGS) console.warn(...args); }
function steamAuthLog(...args) {
    if (STEAM_AUTH_DEBUG || !QUIET_LOGS) console.log(...args);
}
function coverDbgSync(msg, data = {}) {
    try {
        console.log('[CoverDebug:Sync]', msg, data);
    } catch {}
}

const steamApprovalPollUseCase = new PollSteamApprovalUseCase();
const gamesSyncAdapter = new GamesSyncAdapter({ getGamesFeature });

// ─── Paths ───────────────────────────────────────────────────
const LEGENDARY_BIN      = path.join(__dirname, 'bin', 'legendary.exe');
const {
    syncCacheRepository,
    epicSwitcherRepository,
} = createConnectorRepositoryBundle({
    cacheRepositoryOptions: { userDataDir: app.getPath('userData') },
    epicSwitcherRepositoryOptions: {
        accountsRootDir: path.join(app.getPath('userData'), 'accounts'),
    },
});
const SYNC_CACHE_DIR     = syncCacheRepository.syncCacheDir;
const SYNC_LOGS_DIR      = syncCacheRepository.syncLogsDir;

// Epic Paths
const EPIC_MERGED_CACHE            = syncCacheRepository.epicMergedCacheFile;

// Steam Paths
const STEAM_MERGED_CACHE  = syncCacheRepository.steamMergedCacheFile;
let _libraryWriteQueue = Promise.resolve();
let _enrichRequestQueue = Promise.resolve();

// Injected from main.js — same signature as gameScanner's registerImageDownloader.
// Downloads { cover?, hero?, logo? } assets to local image_cache and returns file:// paths.
let _platformSyncAssetDownloader = null;
function registerPlatformSyncAssetDownloader(fn) {
    _platformSyncAssetDownloader = fn;
}

/**
 * Debounced library-updated emitter.
 * Collapses rapid-fire cache-write events into a single IPC send after 1.5s of quiet.
 * Prevents All Games from re-rendering dozens of times during a sync batch.
 */
function _emitLibraryUpdated(win) {
    libraryUpdateEmitter.emit(win);
}

/**
 * Bounded-concurrency iterator: runs fn(item) for each item in items,
 * keeping at most `concurrency` promises in-flight at once.
 * @template T
 * @param {T[]} items
 * @param {(item: T) => Promise<void>} fn
 * @param {number} concurrency
 */
async function _withConcurrency(items, fn, concurrency) {
    if (!items.length || concurrency <= 0) return;
    const queue = [...items];
    await Promise.all(
        Array.from({ length: Math.min(concurrency, items.length) }, async () => {
            while (queue.length > 0) {
                const item = queue.shift();
                if (item !== undefined) await fn(item);
            }
        })
    );
}

function _enqueueLibraryWrite(fn) {
    _libraryWriteQueue = _libraryWriteQueue.then(fn);
    return _libraryWriteQueue;
}

function _waitForLibraryWrites() {
    return _libraryWriteQueue;
}

/**
 * Cover-first image caching for a just-written merged library.
 *
 * Phase 1 — Covers: download remote coverUrls at up to coverConcurrency workers.
 *   After each successful cover, fires coverCachedEmitter immediately for instant
 *   per-card UI patch.  Writes file:// paths back to cacheFile in batches and
 *   fires the debounced emitter (library-updated) every ~500ms as a backup sync.
 * Phase 2 — Secondary: after ALL covers are done, download hero/logo fire-and-
 *   forget at lower concurrency so they never block covers.
 *
 * Stale detection: file:// URLs whose underlying file is missing are cleared
 * from the entry so the renderer can re-trigger its own fetch later.
 *
 * Ownership: entries with customArtworkLocked=true are always skipped.
 *
 * @param {object[]} entries                   - Merged library array (mutated in place)
 * @param {Function} downloader                - (assets, gameId) => Promise<{cover?,hero?,logo?}>
 * @param {string}   cacheFile                 - Absolute path to merged JSON cache
 * @param {Function} matchFn                   - (lib, entry) => index in lib (-1 if absent)
 * @param {Function} [emitter]                 - Debounced library-updated backup emitter
 * @param {object}   [opts]
 * @param {Function} [opts.coverCachedEmitter] - (payload) => void; fired immediately per cached cover
 * @param {Function} [opts.existsFn]           - Override fsSync.existsSync (for unit testing)
 * @param {object}   [opts.fsDeps]             - Override { readFile, writeFile } (for unit testing)
 * @param {number}   [opts.coverConcurrency=10]
 * @param {number}   [opts.secondaryConcurrency=2]
 * @param {number}   [opts.batchSize=20]
 * @param {number}   [opts.libUpdatedDebounceMs=500]
 */
async function cacheLibraryCoversFirst(entries, downloader, cacheFile, matchFn, emitter, opts = {}) {
    const assetWriteBackService = new PlatformSyncAssetWriteBackService({
        fsDeps: opts.fsDeps || {
            readFile: (file, encoding) => fs.readFile(file, encoding),
            writeFile: (file, data, encoding) => fs.writeFile(file, data, encoding),
        },
        existsFn: opts.existsFn || ((file) => fsSync.existsSync(file)),
        enqueueWrite: _enqueueLibraryWrite,
        waitForWrites: _waitForLibraryWrites,
        logger: {
            log: (...args) => syncLog(...args),
            debug: (msg, data) => coverDbgSync(msg, data),
        },
    });

    return assetWriteBackService.cacheLibraryCoversFirst({
        entries,
        downloader,
        cacheFile,
        matchFn,
        emitter,
        opts,
    });
}

// ─── Helpers ─────────────────────────────────────────────────

async function ensureDirs() {
    await syncCacheRepository.ensureDirs();
}

let _platformSyncWindowGetter = null;
const syncLogQueue = new SyncLogQueue({
    now: () => new Date().toISOString(),
    writeLog: async (entry, platform) => {
        const logLine = JSON.stringify(entry) + '\n';
        await ensureDirs();
        await fs.appendFile(path.join(SYNC_LOGS_DIR, `${platform}.log`), logLine, 'utf8');
    },
});
const linkStateEmitter = new LinkStateEmitter();
const libraryUpdateEmitter = new LibraryUpdateEmitter({
    getSavedGames: () => gamesSyncAdapter.getSavedGames(),
    debounceMs: 1500,
});
const syncTerminalEventEmitter = new SyncTerminalEventEmitter({
    getWindow: () => _platformSyncWindowGetter?.(),
    Notification,
});
const stateChangedEmitter = new StateChangedEmitter({
    getWindow: () => _platformSyncWindowGetter?.(),
});
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
        stateChangedEmitter.emit(_clonePlain(_getPlatformSyncState(platform)));
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

    const entry = syncLogQueue.push(platform, {
        level,
        message,
        accountId: extra.accountId ? String(extra.accountId) : null,
        accountName: extra.accountName || null,
    });

    _setPlatformSyncState(platform, (state) => {
        state.logs = [...(state.logs || []), entry].slice(-80);
        return state;
    });
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

    try {
        const finalState = _clonePlain(_getPlatformSyncState(platform));
        const isFailed = patch.phase === 'error' || !!patch.lastError;
        if (isFailed) {
            syncTerminalEventEmitter.emitFailed(finalState);
        } else {
            const notifyGames = patch.targetAccountId
                // Targeted sync — show target account count, not total merged library
                ? finalState.accounts?.[String(patch.targetAccountId)]?.gamesCount || 0
                : finalState.summary?.totalGames || 0;
            const platformName = platform.charAt(0).toUpperCase() + platform.slice(1);
            syncTerminalEventEmitter.emitCompleted(finalState, {
                title: 'Baddel Launcher',
                body: notifyGames > 0
                    ? `${platformName} sync complete — ${notifyGames} games synced.`
                    : `${platformName} library sync complete.`,
                icon: path.join(__dirname, 'Logo.ico'),
            });
        }
    } catch {}
}

function _emitLinkState(mainWindow, platform, status, message, extra = {}) {
    linkStateEmitter.emit(mainWindow, platform, status, message, extra);
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
        syncWarn(`[PlatformSync] Could not write sync_link.json for ${platform}/${switcherProfileName}:`, e.message);
    }
}

// Safe variant — never creates a new directory. Only writes sync_link.json when a
// real switcher profile folder already exists. For Epic it also verifies the folder
// contains actual session data (Data/, Config/, etc.) so phantom folders are ignored.
async function _writeSyncLinkToExistingSwitcherProfile(platform, profileName, platformAccountId, extra = {}) {
    const result = await epicSwitcherRepository.writeSyncLinkToExistingProfile(platform, profileName, platformAccountId, extra);
    if (result.ok) return true;
    if (result.reason === 'missing_profile') {
        syncLog(`[PlatformSync] No existing ${platform} switcher profile "${profileName}"; skipping sync_link write.`);
    } else if (result.reason === 'phantom_profile') {
        syncLog(`[PlatformSync] Epic folder "${profileName}" contains no real session data; skipping sync_link write.`);
    } else if (result.reason === 'error') {
        syncWarn(`[PlatformSync] Could not write sync_link.json for ${platform}/${profileName}:`, result.error.message);
    }
    return false;
}

// Searches existing Epic switcher profiles for one that matches by account ID or
// display name. Returns the profile folder name if found, null otherwise.
async function _findMatchingEpicSwitcherProfile(accountId, displayName) {
    return epicSwitcherRepository.findMatchingEpicProfile(accountId, displayName);
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

async function buildSteamOwnedGameEntries(account, games = []) {
    return mapWithConcurrency(games, 10, async (game) => ({
        id: game.id,
        title: game.title,
        platform: 'steam',
        source: 'steam',
        coverUrl: null,
        heroUrl:  null,
        logoUrl:  null,
        appName: String(game.appid),
        playtime: 0,
        lastSynced: new Date().toISOString(),
        ownedBy: [account.displayName],
        steamAppType: game.steamAppType || null,
        ownedByAccountIds: [String(account.id)],
        steamLicensedAccountIds: [String(account.id)],
    }));
}

async function buildEpicOwnedGameEntries(account, entries = []) {
    const confPath = getLegendaryConfPath(account.id);
    // Defensive: ensure no non-game entries slip through regardless of call site.
    const playableEntries = (Array.isArray(entries) ? entries : []).filter(isEpicPlayableGameEntry);
    return mapWithConcurrency(playableEntries, 10, async (entry) => {
        const gameId = `epic_${entry.app_name}`;
        let metadata = entry.metadata;

        // ─── If metadata is missing from JSON, try to read from disk cache ───
        if (!metadata || !metadata.keyImages) {
            try {
                const diskMeta = await _getLegendaryMetadataFromDisk(confPath, entry.app_name);
                if (diskMeta && diskMeta.metadata) {
                    metadata = diskMeta.metadata;
                    // syncLog(`[Epic Sync] Found disk metadata for ${entry.app_name}`);
                }
            } catch (err) {
                // syncWarn(`[Epic Sync] Failed to read disk metadata for ${entry.app_name}:`, err.message);
            }
        }

        // All image caching is now handled by baddelapi
        const newCoverUrl = _pickEpicCover(metadata?.keyImages);

        return {
            id: gameId,
            title: entry.app_title || entry.app_name,
            platform: 'epic',
            source: 'epic',
            coverUrl: newCoverUrl || null,
            heroUrl: _pickEpicHero(metadata?.keyImages),
            logoUrl: _pickEpicLogo(metadata?.keyImages),
            appName: entry.app_name,
            namespace: entry.metadata?.namespace 
                    || Object.values(entry.asset_infos || {})[0]?.namespace
                    || metadata?.namespace 
                    || '',
            // ── FIX: expose namespace as allIds.epic so game-details.js uses
            // the correct server lookup ID (namespace UUID, NOT appName).
            // The server stores Epic games by catalog_namespace, not app_name.
            allIds: {
                epic: entry.metadata?.namespace
                    || Object.values(entry.asset_infos || {})[0]?.namespace
                    || metadata?.namespace
                    || null,
            },
            catalogItemId: entry.catalog_item_id || metadata?.id || '',
            // الكود الجديد: هناخد بس الحاجات اللي السيرفر محتاجها كـ Fallback
            epicMetadata: metadata ? {
                developer: metadata.developer || null,
                description: metadata.description || null,
                creationDate: metadata.creationDate || null,
                namespace: metadata.namespace || null
            } : null, 
            lastSynced: new Date().toISOString(),
            ownedBy: [account.displayName],
            ownedByAccountIds: [String(account.id)],
            thirdPartyLauncher: entry.third_party_store || null,
            requiresExternalLauncher: false, // keep EA/third-party games visible in library
        };
    });
}

async function _getLegendaryMetadataFromDisk(confPath, appName) {
    // Build a list of all known account config paths, current account first
    const allConfPaths = [confPath];
    try {
        const otherAccounts = await getEpicAccountsList();
        for (const a of otherAccounts) {
            const p = getLegendaryConfPath(a.id);
            if (p !== confPath) allConfPaths.push(p);
        }
    } catch {}

    // Search across all account folders — metadata may live in a different account's folder
    for (const p of allConfPaths) {
        try {
            const metaPath = path.join(p, 'metadata', `${appName}.json`);
            if (fsSync.existsSync(metaPath)) {
                const raw = await fs.readFile(metaPath, 'utf8');
                return JSON.parse(raw);
            }
        } catch (err) {
            console.error('[Epic Sync Disk Meta] Error reading from', p, ':', err.message);
        }
    }
    return null;
}

async function fetchSteamOwnedGamesWithRetry(account, previousCount, initialSessionSteamId) {
    const aid = String(account.id);
    let result = await steamBridge.getOwnedGames();
    let rawGamesCount = Array.isArray(result?.games) ? result.games.length : 0;
    const shouldRetry = result?.status === 'success' && rawGamesCount === 0;

    if (!shouldRetry) {
        // syncLog(`[Sync:${account.displayName}] getOwnedGames → ${rawGamesCount} games (no retry needed)`);
        return { result, rawGamesCount };
    }

    // syncWarn(`[Sync:${account.displayName}] ⚠ getOwnedGames returned 0 — retrying after 1.5s grace period`);
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
    syncLog(`[Sync:${account.displayName}] Retry → ${retryCount} games`);

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

    steamBridge.on('gamesUpdate', async (payload) => {
        // Payload from Python is { steamAccountId, games } (new shape) or a legacy raw array.
        const isLegacyArray = Array.isArray(payload);
        const newGames = isLegacyArray ? payload : (Array.isArray(payload?.games) ? payload.games : []);
        // Always read the account id from the event payload — never from getLastSessionSteamId()
        // at handling time, because a later sync for a different account may now be active.
        const sid = isLegacyArray ? null : (payload?.steamAccountId ? String(payload.steamAccountId).trim() : null);

        if (!newGames.length) return;

        // If a sync is actively running, skip background writes to avoid cross-account contamination.
        if (_getPlatformSyncState('steam').isSyncing) {
            syncLog(`[SteamBridge] Background gamesUpdate received during active sync — skipped to prevent cross-account write (steamAccountId=${sid ?? 'unknown'})`);
            return;
        }

        if (!sid) {
            syncWarn(`[SteamBridge] Background gamesUpdate has no steamAccountId — skipping ownership attribution (${newGames.length} games ignored)`);
            return;
        }

        syncLog(`[SteamBridge] 🎮 Background: ${newGames.length} new games from account ${sid}`);
        try {
            const existing = await syncCacheRepository.readSteamMergedLibrary();
            const map = new Map(existing.map(g => [g.id, g]));
            const accs = steamConnector.getAccounts();
            const accMatch = accs.find((a) => String(a.id) === sid) || null;
            const displayNames = accMatch ? [accMatch.displayName] : [];

            for (const g of newGames) {
                if (!map.has(g.id)) {
                    map.set(g.id, {
                        id: g.id,
                        title: g.title,
                        platform: 'steam',
                        source: 'steam',
                        coverUrl: null,
                        heroUrl:  null,
                        logoUrl:  null,
                        appName: String(g.appid),
                        playtime: 0,
                        lastSynced: new Date().toISOString(),
                        ownedBy: displayNames,
                        ownedByAccountIds: [sid],
                        steamLicensedAccountIds: [sid],
                    });
                } else {
                    const ex = map.get(g.id);
                    if (!ex.steamLicensedAccountIds) ex.steamLicensedAccountIds = [];
                    if (!ex.steamLicensedAccountIds.map(String).includes(sid)) ex.steamLicensedAccountIds.push(sid);
                    if (!ex.ownedByAccountIds) ex.ownedByAccountIds = [];
                    if (!ex.ownedByAccountIds.map(String).includes(sid)) ex.ownedByAccountIds.push(sid);
                    if (accMatch) {
                        if (!ex.ownedBy) ex.ownedBy = [];
                        if (!ex.ownedBy.includes(accMatch.displayName)) ex.ownedBy.push(accMatch.displayName);
                    }
                }
            }
            await syncCacheRepository.writeSteamMergedLibrary([...map.values()]);
        } catch (e) {
            console.error('[SteamBridge] Failed to merge background games:', e.message);
        }
    });
}

// ─── Steam Mobile Approval Auto-Polling ──────────────────────
//
// Called when the Steam confirm (mobile approval) view is shown.
// Polls every 2s; on success closes the window and resolves the auth promise.
// Returns a stop function the caller can invoke to cancel polling.

// Pure step handler — exported for testing.
function _mobileApprovalPollStep(status, attempt, maxAttempts) {
    return steamApprovalPollUseCase.pollStep({ status, attempt, maxAttempts });
}

function _startMobileApprovalPolling(win, resolve, reject) {
    const CONFIRM_STUB = 'baddel://steam/two_factor_confirm_finished';
    const POLL_INTERVAL_MS  = 2000;
    const POLL_TIMEOUT_MS   = 15000;
    const FALLBACK_MS       = 20000;
    const MAX_ATTEMPTS      = 90; // ~3 min

    let active = true;
    let attempt = 0;
    const diagLog = [];
    console.log('[SteamLinkDiag] polling started');

    const injectUiUpdate = (msg, reenableButton = false) => {
        if (!win || win.isDestroyed()) return;
        const escaped = msg.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        win.webContents.executeJavaScript(`
            (function(){
                var el = document.querySelector('#steamGuardConfirm .waiting-status span');
                if (el) el.textContent = '${escaped}';
                ${reenableButton ? `
                var btn = document.getElementById('continueBtn');
                if (btn) { btn.disabled = false; btn.style.opacity = ''; }
                ` : ''}
            })();
        `).catch(() => {});
    };

    const writeDiag = (finalStatus) => {
    try {
        const { app: electronApp } = require('electron');
        const diagPath = path.join(electronApp.getPath('userData'), 'steam-link-diagnostics.json');
        fsSync.writeFileSync(diagPath, JSON.stringify({
            timestamp: new Date().toISOString(),
            finalStatus,
            totalAttempts: attempt,
            log: diagLog,
        }, null, 2));
        console.log('[SteamLinkDiag] wrote:', diagPath);
    } catch (e) {
        console.error('[SteamLinkDiag] failed:', e.message);
    }
};

    // 20-second fallback — re-enable the button so the user isn't permanently stuck
    const fallbackTimer = setTimeout(() => {
        if (active) injectUiUpdate('Still waiting… Keep Steam open and approve the same request.', false);
    }, FALLBACK_MS);

    const stop = () => {
        active = false;
        clearTimeout(fallbackTimer);
    };

    const poll = async () => {
        if (!active || !win || win.isDestroyed()) return;

        const thisAttempt = ++attempt;
        if (thisAttempt > MAX_ATTEMPTS) {
            stop();
            injectUiUpdate('Approval request expired. Click Continue to try again.', true);
            writeDiag('max_attempts');
            return;
        }

        const t0 = Date.now();
        let result = null;
        try {
            result = await Promise.race([
                steamBridge.passLoginCredentials(CONFIRM_STUB, {}),
                new Promise((_, rej) => setTimeout(() => rej(new Error('poll timeout')), POLL_TIMEOUT_MS)),
            ]);

            const elapsed = Date.now() - t0;
            diagLog.push({ attempt: thisAttempt, status: result?.status ?? 'null', elapsed });
            if (diagLog.length > 20) diagLog.shift();
            console.log('[SteamLinkDiag] attempt:', thisAttempt, 'status:', result?.status, 'elapsed:', elapsed);
            writeDiag('live_poll');

            if (!active) return;

            const next = _mobileApprovalPollStep(result?.status, thisAttempt, MAX_ATTEMPTS);

            if (next.action === 'resolved') {
                stop();
                if (!win.isDestroyed()) win.close();
                resolve(result);
            } else if (next.action === 'stop') {
                stop();
                injectUiUpdate(next.message, next.reenableButton);
                if (next.writeDiag) writeDiag(next.writeDiag);
            } else {
                if (next.message) injectUiUpdate(next.message);
                setTimeout(poll, POLL_INTERVAL_MS);
            }
        } catch (e) {
            const elapsed = Date.now() - t0;
            diagLog.push({ attempt: thisAttempt, status: 'exception', error: e.message, elapsed });
            if (diagLog.length > 20) diagLog.shift();
            console.error('[SteamLinkDiag] poll exception:', e.message);
            writeDiag('poll_exception');
            if (active) setTimeout(poll, POLL_INTERVAL_MS);
        }
    };

    // Disable button and show initial status
    if (!win.isDestroyed()) {
        win.webContents.executeJavaScript(`
            (function(){
                var el = document.querySelector('#steamGuardConfirm .waiting-status span');
                if (el) el.textContent = 'Waiting for your approval. This will continue automatically.';
                var btn = document.getElementById('continueBtn');
                if (btn) { btn.disabled = true; btn.style.opacity = '0.45'; }
            })();
        `).catch(() => {});
    }

    setTimeout(poll, POLL_INTERVAL_MS);
    return stop;
}

// ─── QR Login Flow ───────────────────────────────────────────
//
// Starts a QR auth session: generates a QR image, loads the steam_qr view,
// and polls until authenticated, expired, or denied.
// onStop(stopFn) is called immediately with a cancellation function.

async function _startQrLoginFlow(win, resolve, reject, onStop) {
    const qrPollingLoop = createSteamQrPollingLoop({
        pollSteamAuth: () => steamBridge.pollSteamAuth(),
        isWindowDestroyed: () => !win || win.isDestroyed(),
        closeWindow: () => win.close(),
        resolve,
        reject,
        restart: () => _startQrLoginFlow(win, resolve, reject, onStop),
        logger: console,
        setTimeoutFn: setTimeout,
        clearTimeoutFn: clearTimeout,
    });
    if (typeof onStop === 'function') onStop(qrPollingLoop.stop);

    let qrData;
    try {
        qrData = await steamBridge.startQrLogin();
    } catch (e) {
        console.error('[QR] startQrLogin failed:', e.message);
        return;
    }

    if (qrData?.status !== 'need_qr' || !qrData.challengeUrl) {
        console.error('[QR] Unexpected status from startQrLogin:', qrData?.status);
        return;
    }

    const { challengeUrl, interval } = qrData;
    const pollIntervalMs = Math.max((interval || 2) * 1000, 2000);

    let qrDataUrl;
    try {
        const QRCode = require('qrcode');
        qrDataUrl = await QRCode.toDataURL(challengeUrl, { width: 200, margin: 1 });
    } catch (e) {
        console.error('[QR] QR code generation failed:', e.message);
        return;
    }

    if (!win || win.isDestroyed()) return;

    try {
        const currentRaw = win.webContents.getURL();
        const currentUrl = new URL(currentRaw);
        currentUrl.searchParams.set('view', 'steam_qr');
        currentUrl.searchParams.delete('errored');
        await win.loadURL(currentUrl.href);
    } catch (e) {
        console.error('[QR] Failed to load steam_qr view:', e.message);
        return;
    }

    try {
        const escaped = qrDataUrl.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        await win.webContents.executeJavaScript(`
            (function(){
                var container = document.getElementById('steamQRCode');
                if (container) {
                    container.innerHTML = '<img src="${escaped}" width="200" height="200" alt="QR Code" style="border-radius:8px;display:block;" />';
                }
                var status = document.querySelector('#steamGuardQR .qr-status');
                if (status) status.textContent = 'Scan with your Steam mobile app';
            })();
        `);
    } catch (e) {
        console.error('[QR] Failed to inject QR image:', e.message);
    }

    qrPollingLoop.start(pollIntervalMs);
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
            console.log('[STEAM-LINK-DEBUG] initial authResult:', JSON.stringify(authResult, null, 2));
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

        let approvalPollStop = null;

        const stopApprovalPoll = () => {
            if (approvalPollStop) { approvalPollStop(); approvalPollStop = null; }
        };

        const handleBaddelAuthUrl = async (url) => {
            const action = url.replace('baddel://auth/', '');
            if (action === 'qr-start') {
                stopApprovalPoll();
                await _startQrLoginFlow(win, resolve, reject, (stopFn) => { approvalPollStop = stopFn; });
            } else if (action === 'login-form') {
                stopApprovalPoll();
                const loginUrl = authResult.passwordLoginUrl;
                if (loginUrl) {
                    currentEndUriRegex = authResult.endUriRegex;
                    await win.loadURL(loginUrl);
                }
            }
        };

        const checkUrl = async (url) => {
            if (!currentEndUriRegex) return;
            const regex = new RegExp(currentEndUriRegex);
            if (!regex.test(url)) return;

            // User manually submitted while polling — stop poll, let checkUrl own this
            stopApprovalPoll();

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
                    await win.loadURL(result.loginUrl);
                    if (result.method === 'confirm') {
                        approvalPollStop = _startMobileApprovalPolling(win, resolve, reject);
                    }
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
            if (url.startsWith('baddel://auth/')) {
                _e.preventDefault();
                handleBaddelAuthUrl(url);
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
        return syncCacheRepository.isSteamLinked();
    },

    getAccounts() {
        return syncCacheRepository.readSteamAccountsSync()
            .map((a) => ({ ...a, id: String(a.id) }));
    },

    async link(parentWindow) {
        steamAuthLog('[PlatformSync:Steam] link:start');
        await ensureDirs();
        steamAuthLog('[PlatformSync:Steam] ensureDirs:ok');
        try {
            await _ensureBridgeRunning();
        } catch (err) {
            console.error('[PlatformSync:Steam] Failed to start Steam bridge:', err);
            const e = new Error(`Steam bridge failed to start: ${err.message || err}`);
            e.code = 'STEAM_BRIDGE_START_FAILED';
            throw e;
        }
        steamAuthLog('[PlatformSync:Steam] bridge:running');

        const authResult = await _openSteamLoginWindow(parentWindow, null);
        steamAuthLog('[PlatformSync:Steam] auth window returned:', authResult?.status);

        if (authResult.status !== 'authenticated') {
            throw new Error('Steam authentication failed');
        }

        const { steamId, personaName } = authResult;
        const steamIdStr  = String(steamId);
        const displayName = personaName || `Steam ${steamIdStr.slice(-6)}`;

        // Wait for the Python bridge to emit store_credentials for this account.
        // Required so that syncLibrary() can authenticate after an app restart.
        const storedCreds = await steamBridge.waitForCredentials(steamIdStr, 12_000);
        if (!storedCreds) {
            steamAuthLog(`[PlatformSync:Steam] ⚠ Credentials not confirmed for ${steamIdStr} within 12s — account will require reconnect on next sync`);
        } else {
            steamAuthLog(`[PlatformSync:Steam] ✅ Credentials confirmed for ${steamIdStr}`);
        }

        const now = new Date().toISOString();
        let accounts = this.getAccounts();
        const existingIndex = accounts.findIndex(a => String(a.id) === steamIdStr);

        const accountEntry = {
            id:               steamIdStr,
            displayName,
            status:           'linked',
            credentialStatus: storedCreds ? 'ok' : 'pending',
            needsReauth:      !storedCreds,
            lastLinkedAt:     now,
            // Preserve lastSyncedAt and gamesCount from a previous link if present
            ...(existingIndex > -1
                ? { lastSyncedAt: accounts[existingIndex].lastSyncedAt,
                    gamesCount:   accounts[existingIndex].gamesCount }
                : {}),
        };

        if (existingIndex > -1) {
            accounts[existingIndex] = { ...accounts[existingIndex], ...accountEntry };
        } else {
            accounts.push(accountEntry);
        }

        if (accounts.length === 0) {
            console.error('[PlatformSync:Steam] Account list is empty after linking — blocking save');
            throw new Error('Failed to update account list.');
        }

        await syncCacheRepository.writeSteamAccountsAtomic(accounts);
        await _writeSwitcherSyncLink('steam', displayName, steamIdStr, { steamDisplayName: displayName });

        steamAuthLog(`[PlatformSync:Steam] ✅ Linked ${displayName} (${steamIdStr}) credentialStatus=${accountEntry.credentialStatus}`);
        analytics.logPlatformLinked('steam').catch(() => {});
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
                syncWarn(`[PlatformSync] Target account ${targetAccountId} not found in linked accounts, syncing all.`);
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

        // For targeted sync: add non-target accounts to the state with clean terminal status.
        // Never restore transient (queued/pending/syncing/etc.) states from a previous run.
        if (targetAccountId) {
            for (const account of allAccounts) {
                const aid = String(account.id);
                if (orderedAccounts.some(a => String(a.id) === aid)) continue;
                const prevCount = countGamesForAccount('steam', previousGames, aid);
                const terminal = computeTerminalAccountStatus(account, prevCount);
                _updatePlatformSyncAccount('steam', aid, {
                    id: aid,
                    displayName: account.displayName || aid,
                    gamesCount: prevCount,
                    gameTitles: [],
                    startedAt: null,
                    finishedAt: null,
                    ...terminal,
                });
            }
        }

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
                        // Mark account as needing reauth so the UI shows "Reconnect required"
                        // and we stop pretending the account is fully linked.
                        const savedAccts = this.getAccounts();
                        const acctIdx = savedAccts.findIndex(a => String(a.id) === aid);
                        if (acctIdx > -1) {
                            savedAccts[acctIdx] = {
                                ...savedAccts[acctIdx],
                                needsReauth:      true,
                                credentialStatus: 'missing',
                                status:           'needs_reauth',
                            };
                            syncCacheRepository.writeSteamAccountsAtomic(savedAccts).catch(() => {});
                        }
                        accountResults[aid] = { status: 'warning', rawGamesCount: 0, validationFailed: true, allowZeroGames: false };
                        _updatePlatformSyncAccount('steam', aid, {
                            status: 'warning',
                            finishedAt: new Date().toISOString(),
                            gamesCount: previousCount,
                            message: 'Steam session expired. Reconnect this account.',
                        });
                        _pushPlatformSyncLog('steam', 'warn', `Skipping ${account.displayName} — no stored credentials found. Account needs reauth.`, {
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
                        syncWarn(`[Sync:${account.displayName}] AUTH MISMATCH — expected ${aid}, got ${authResult.steamId}. Skipping game fetch, preserving cache.`);
                        _pushPlatformSyncLog('steam', 'warn', `Steam session mismatch for ${account.displayName}: expected ${aid}, got ${authResult.steamId}. Cached library preserved.`, {
                            accountId: aid,
                            accountName: account.displayName,
                        });
                        accountResults[aid] = { status: 'warning', rawGamesCount: 0, validationFailed: true, allowZeroGames: false };
                        _updatePlatformSyncAccount('steam', aid, {
                            status: 'warning',
                            finishedAt: new Date().toISOString(),
                            gamesCount: previousCount,
                            message: 'Steam session returned the wrong account. Cached data will be kept.',
                        });
                        continue;
                    }

                    _updatePlatformSyncAccount('steam', aid, {
                        status: 'syncing',
                        message: 'Loading owned games',
                    });

                    steamAuthLog(`[Sync:${account.displayName}] cacheIsReady=${steamBridge._cacheIsReady} — calling waitForCacheReady(targetId=${aid}, 60s)`);
                    await steamBridge.waitForCacheReady(aid, 60_000);

                    // Re-check session after waiting: a concurrent auth may have switched accounts.
                    const postWaitSession = String(steamBridge.getLastSessionSteamId?.() || '');
                    if (postWaitSession && postWaitSession !== aid) {
                        steamAuthLog(`[Sync:${account.displayName}] Post-wait session mismatch: session is now ${postWaitSession}, expected ${aid}. Skipping getOwnedGames.`);
                        _pushPlatformSyncLog('steam', 'warn', `Steam session changed while waiting for cache (expected ${aid}, now ${postWaitSession}). Cached library preserved.`, {
                            accountId: aid,
                            accountName: account.displayName,
                        });
                        accountResults[aid] = { status: 'warning', rawGamesCount: 0, validationFailed: true, allowZeroGames: false };
                        _updatePlatformSyncAccount('steam', aid, {
                            status: 'warning',
                            finishedAt: new Date().toISOString(),
                            gamesCount: previousCount,
                            message: 'Steam session changed during sync. Cached data will be kept.',
                        });
                        continue;
                    }

                    steamAuthLog(`[Sync:${account.displayName}] ✅ waitForCacheReady done — fetching games`);

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
                    // NOTE: metadata sync is deferred to the single post-finalization call on finalGames.

                    const accountStatus = rawGamesCount > 0 ? 'success' : (previousCount > 0 ? 'warning' : 'success');

                    // Store rawGamesCount and previousCount so the finalization pass can
                    // build the definitive user-visible message once finalCount is known.
                    accountResults[aid] = {
                        status:          accountStatus,
                        rawGamesCount,
                        previousCount,
                        reachedFetch:    true,
                        validationFailed: rawGamesCount === 0 && previousCount > 0,
                        allowZeroGames:  previousCount === 0,
                    };

                    // Interim message — finalization will replace it with the final
                    // count-aware message once deduplicated counts are available.
                    const interimMessage = rawGamesCount > 0
                        ? `Fetched ${rawGamesCount} entries; finalizing library…`
                        : (previousCount > 0 ? 'Steam returned 0 entries; preserving cached library…' : 'No owned games found');

                    _updatePlatformSyncAccount('steam', aid, {
                        status:    accountStatus,
                        finishedAt: new Date().toISOString(),
                        gamesCount: rawGamesCount > 0 ? rawGamesCount : previousCount,
                        gameTitles: summarizeGameTitles(result.games),
                        message:   interimMessage,
                    });
                    // steam_accounts.json persistence is deferred to the finalization
                    // pass so gamesCount reflects the deduplicated final library count.
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

            const localGames = await gamesSyncAdapter.getLocalSteamGames().catch((err) => {
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
                        coverUrl:                null,
                        heroUrl:                 null,
                        logoUrl:                 null,
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

            // Local install-only games are kept in the library as installOnly:true but are NOT
            // attributed to any account — detected installs are not evidence of licensed ownership.
            // The fallbackLocalAccount / steamDetectedAccountIds attribution block has been removed.
            // countGamesForAccount() and the UI helpers must not treat steamDetectedAccountIds as ownership.

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
                const aid          = String(account.id);
                const existingState = _getPlatformSyncState('steam').accounts?.[aid] || {};
                const accountGames = finalGames.filter((game) => steamGameBelongsToAccount(game, aid));
                const finalCount   = finalized.validation.countsByAccount?.[aid] ?? existingState.gamesCount ?? 0;

                const patch = {
                    gamesCount: finalCount,
                    gameTitles: summarizeGameTitles(accountGames),
                };

                if (accountResults[aid]?.reachedFetch) {
                    // Account was actively fetched this sync — compute the definitive message
                    // now that the deduplicated final count is known.
                    const rawCount  = accountResults[aid].rawGamesCount ?? 0;
                    const prevCount = accountResults[aid].previousCount
                        ?? countGamesForAccount('steam', previousGames, aid);

                    patch.message = computeSteamSyncMessage(rawCount, finalCount, prevCount);
                    patch.status  = 'synced';
                    patch.finishedAt = new Date().toISOString();

                    console.log(`[PlatformSync:Steam] ${account.displayName}: raw=${rawCount}, final=${finalCount}, previous=${prevCount}`);
                    _pushPlatformSyncLog('steam', 'info',
                        `${account.displayName}: raw=${rawCount}, final=${finalCount}, previous=${prevCount}`,
                        { accountId: aid, accountName: account.displayName });

                    // Persist final (deduplicated) counts to steam_accounts.json.
                    if (accountResults[aid].status === 'success' || rawCount > 0) {
                        const savedAccts = this.getAccounts();
                        const acctIdx = savedAccts.findIndex(a => String(a.id) === aid);
                        if (acctIdx > -1) {
                            savedAccts[acctIdx] = {
                                ...savedAccts[acctIdx],
                                lastSyncedAt:     new Date().toISOString(),
                                gamesCount:       finalCount,
                                needsReauth:      false,
                                credentialStatus: 'ok',
                                status:           'synced',
                            };
                            syncCacheRepository.writeSteamAccountsAtomic(savedAccts).catch(() => {});
                        }
                    }
                } else {
                    // Non-fetched account (not the sync target, or auth failed before fetch).
                    // Apply a clean terminal status — never leave transient state after sync ends.
                    const existingStatus = _getPlatformSyncState('steam').accounts?.[aid]?.status;
                    if (!existingStatus || TRANSIENT_SYNC_STATUSES.has(existingStatus)) {
                        const terminal = computeTerminalAccountStatus(account, finalCount);
                        patch.status = terminal.status;
                        patch.message = terminal.message;
                        patch.finishedAt = new Date().toISOString();
                    }
                    // Preserve non-transient terminal status (e.g. 'error') set in the main loop.
                }

                _updatePlatformSyncAccount('steam', aid, patch);
            }

            for (const issue of finalized.validation.issues || []) {
                _pushPlatformSyncLog('steam', 'warn', issue);
            }

            await syncCacheRepository.writeSteamMergedLibrary(finalGames);

            // ── Cover-first image caching (fire-and-forget) ───────────────────
            if (_platformSyncAssetDownloader) {
                const _cfWin = _platformSyncWindowGetter?.();
                cacheLibraryCoversFirst(
                    finalGames, _platformSyncAssetDownloader, STEAM_MERGED_CACHE,
                    (lib, e) => lib.findIndex(lg => String(lg.appName) === String(e.appName)),
                    null,
                    {
                        coverCachedEmitter: (payload) => {
                            if (_cfWin && !_cfWin.isDestroyed()) {
                                _cfWin.webContents.send('all-games-cover-cached', payload);
                            }
                        },
                    }
                ).catch(e => syncWarn('[CoverFirst] steam error:', e.message));
            }

            // ── Send to Baddel server in background ──────────────────────────
            _pushPlatformSyncLog('steam', 'info', 'Sending library to Baddel server...');
            _importLibraryToServer('steam', finalGames).catch(err =>
                _pushPlatformSyncLog('steam', 'warn', `Baddel server import failed: ${err.message}`)
            );

            _updatePlatformSyncProgress('steam', {
                completedAccounts: orderedAccounts.length,
                totalAccounts: orderedAccounts.length,
                currentAccountId: null,
                currentAccountName: null,
            });
            // Build a statusText appropriate to whether this was a targeted or full sync.
            const targetAccount = targetAccountId
                ? orderedAccounts.find(a => String(a.id) === String(targetAccountId)) : null;
            const targetFinalCount = targetAccount
                ? (finalized.validation.countsByAccount?.[String(targetAccountId)] ?? 0) : null;
            const hasFinalIssues = finalized.validation.issues.length > 0;
            const finishStatusText = targetAccount
                ? `${targetAccount.displayName} sync completed. ${targetFinalCount} games synced. Steam library: ${finalGames.length} total.`
                : (hasFinalIssues
                    ? `Steam sync completed with recovery checks. ${finalGames.length} games ready.`
                    : `Steam sync completed. ${finalGames.length} games ready.`);

            _finishPlatformSync('steam', {
                phase: 'done',
                statusText: finishStatusText,
                validation: finalized.validation,
                summary,
                targetAccountId: targetAccountId || null,
            });
            _pushPlatformSyncLog('steam', 'info', `Steam sync finished with ${finalGames.length} games and ${addedFromLocal} local-only additions`);
            analytics.logSyncCompleted('steam', finalGames.length, orderedAccounts.length).catch(() => {});
            return finalGames;
        } catch (err) {
            // On failure, clean transient states for non-target accounts so they are never
            // left stuck as Queued/Pending.
            if (targetAccountId) {
                for (const account of allAccounts) {
                    const aid = String(account.id);
                    if (orderedAccounts.some(a => String(a.id) === aid)) continue;
                    const prevCount = countGamesForAccount('steam', previousGames, aid);
                    const terminal = computeTerminalAccountStatus(account, prevCount);
                    _updatePlatformSyncAccount('steam', aid, {
                        ...terminal,
                        gamesCount: prevCount,
                        finishedAt: new Date().toISOString(),
                    });
                }
            }
            _finishPlatformSync('steam', {
                phase: 'error',
                statusText: `Steam sync failed: ${err.message}`,
                lastError: err.message,
            });
            _pushPlatformSyncLog('steam', 'error', `Steam sync crashed: ${err.message}`);
            analytics.logSyncFailed('steam', err.message).catch(() => {});
            throw err;
        }
    },

    async getCachedLibrary() {
        return syncCacheRepository.readSteamMergedLibrary();
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

        await syncCacheRepository.writeSteamAccounts(accounts);

        if (accounts.length === 0) {
            await syncCacheRepository.deleteSteamMergedLibrary();
            if (steamBridge.isRunning) await steamBridge.stop();
            _bridgeStarted = false;
        } else if (removedAccount) {
            const cachedGames = await this.getCachedLibrary();
            const filteredGames = removeAccountFromLibrary('steam', cachedGames, removedAccount);
            await syncCacheRepository.writeSteamMergedLibrary(filteredGames);
        }
        analytics.logPlatformUnlinked('steam').catch(() => {});
    },
};


// ============================================================
// ─── EPIC CONNECTOR ─────────────────────────────────────────
// ============================================================

function getLegendaryConfPath(accountId) {
    return path.join(app.getPath('userData'), `legendary-config-${accountId}`);
}

async function getEpicAccountsList() {
    return syncCacheRepository.readEpicAccounts();
}

async function saveEpicAccountsList(accounts) {
    await syncCacheRepository.writeEpicAccounts(accounts);
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
        let settled   = false;
        const sessionId = Date.now();

        function log(level, msg, extra = '') {
            const line = `[Epic Login][${sessionId}] ${msg}${extra ? ' | ' + extra : ''}`;
            if (level === 'error') console.error(line);
            else if (level === 'warn')  syncWarn(line);
            else                        syncLog(line);
        }

        function settle(fn) {
            if (settled) return;
            settled = true;
            fn();
        }

        const { session: electronSession } = require('electron');

        const partitionName = `epic-login-${sessionId}`;
        log('info', `Creating fresh session: ${partitionName}`);
        const epicSession = electronSession.fromPartition(partitionName, { cache: false });

        const win = new BrowserWindow({
            width: 480, height: 660, parent: parentWindow || undefined, modal: !!parentWindow,
            frame: false, backgroundColor: '#121212',
            show: false,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                sandbox: false,
                session: epicSession,          // fresh session every time
            },
            title: 'Connect Epic Games',
        });

        win.once('ready-to-show', () => {
            log('info', 'Window ready-to-show → showing');
            win.show();
        });

        // Use the real Chromium version — spoofing Chrome/120 causes Talon fingerprint mismatch → 409
        const chromeVer = process.versions.chrome || '120.0.0.0';
        const customUserAgent = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVer} Safari/537.36`;
        syncLog('[Epic Login] Using UA:', customUserAgent);

        // ── Log every Epic request/response ─────────────────────────
        epicSession.webRequest.onBeforeRequest({ urls: ['*://*.epicgames.com/*'] }, (details, callback) => {
            log('info', `→ ${details.method} ${details.url}`);
            callback({});
        });

        epicSession.webRequest.onCompleted({ urls: ['*://*.epicgames.com/*'] }, (details) => {
            const level = details.statusCode >= 400 ? 'error' : 'info';
            log(level, `← ${details.statusCode} ${details.url}`);
            if (details.statusCode >= 400) {
                log('error', `FAILED headers: ${JSON.stringify(details.responseHeaders)}`);
            }
        });

        epicSession.webRequest.onErrorOccurred({ urls: ['*://*.epicgames.com/*'] }, (details) => {
            log('error', `NET ERROR ${details.url} | ${details.error}`);
        });

        // ── Log WebView console output ───────────────────────────────
        win.webContents.on('console-message', (_e, level, message) => {
            const lvl = ['verbose', 'info', 'warn', 'error'][level] || 'info';
            log(lvl, `[WebView] ${message}`);
        });

        // ── Log navigations ──────────────────────────────────────────
        win.webContents.on('did-start-navigation', (_e, url, _isInPlace, isMainFrame) => {
            if (isMainFrame) log('info', `Navigation start → ${url}`);
        });

        win.webContents.on('did-fail-load', (_e, errorCode, errorDescription, url) => {
            log('error', `did-fail-load ${errorCode} ${errorDescription} | ${url}`);
        });

        // ── Inject UI chrome + intercept auth code ───────────────────
        win.webContents.on('did-navigate', async (_e, url, httpStatus) => {
            log('info', `did-navigate → ${url} (HTTP ${httpStatus})`);

            win.webContents.insertCSS(`
                #nav-logo-con, .site-navbar, footer { display: none !important; }
            `).catch(() => {});

            win.webContents.executeJavaScript(`
                (function() {
                    if (document.getElementById('baddel-close-btn')) return;
                    const btn = document.createElement('div');
                    btn.id = 'baddel-close-btn';
                    btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
                    btn.style.cssText = 'position:fixed; top:12px; right:12px; width:32px; height:32px; background:rgba(255,255,255,0.1); border-radius:50%; display:flex; align-items:center; justify-content:center; cursor:pointer; z-index:999999; transition:0.2s;';
                    btn.onmouseover = () => btn.style.background = 'rgba(255,255,255,0.2)';
                    btn.onmouseout  = () => btn.style.background = 'rgba(255,255,255,0.1)';
                    btn.onclick = () => window.close();
                    document.body.appendChild(btn);
                    const drag = document.createElement('div');
                    drag.style.cssText = 'position:fixed; top:0; left:0; right:50px; height:40px; -webkit-app-region:drag; z-index:999998;';
                    document.body.appendChild(drag);
                })();
            `).catch(() => {});

            if (!url.includes('/id/api/redirect')) return;

            log('info', 'Redirect URL detected — attempting to read auth code');
            try {
                const bodyText = await win.webContents.executeJavaScript('document.body.innerText');
                log('info', `Redirect body (first 300): ${redactSecrets(String(bodyText).slice(0, 300))}`);
                const data = JSON.parse(bodyText);
                if (data?.authorizationCode) {
                    log('info', `Auth code received ✓ length=${data.authorizationCode.length} [value redacted]`);
                    codeFound = true;
                    settle(() => { win.close(); resolve(data.authorizationCode); });
                } else {
                    log('warn', `No authorizationCode in redirect. Keys: ${Object.keys(data).join(', ')}`);
                }
            } catch (err) {
                log('warn', `Could not parse redirect body: ${err.message}`);
            }
        });

        win.on('closed', () => {
            log('info', `Window closed. codeFound=${codeFound} settled=${settled}`);
            settle(() => { if (!codeFound) reject(new Error('Epic login cancelled.')); });
        });

        const LOGIN_URL = `https://www.epicgames.com/id/login?redirectUrl=${encodeURIComponent(`https://www.epicgames.com/id/api/redirect?clientId=34a02cf8f4414e29b15921876da36f9a&responseType=code`)}`;
        log('info', `Loading login URL with session ${partitionName}`);

        win.loadURL(LOGIN_URL, { userAgent: customUserAgent }).catch((err) => {
            log('error', `loadURL failed: ${err.message}`);
            settle(() => reject(new Error(`Could not load Epic login page: ${err.message}`)));
        });
    });
}

function _pickEpicCover(keyImages) {
    if (!Array.isArray(keyImages) || keyImages.length === 0) return null;
    // OfferImageTall is episode/item-specific art; DieselGameBoxTall is often shared season art.
    // Prefer OfferImageTall first to avoid all episodes showing the same season cover.
    const PREF = ['OfferImageTall', 'DieselGameBoxTall', 'DieselGameBox', 'Thumbnail'];
    for (const type of PREF) {
        const img = keyImages.find(k => k.type === type);
        if (img?.url) return img.url;
    }
    return keyImages[0]?.url || null;
}

function _pickEpicHero(keyImages) {
    if (!Array.isArray(keyImages) || keyImages.length === 0) return null;
    // OfferImageWide is episode-specific; DieselGameBox may be shared season art.
    const PREF = ['OfferImageWide', 'DieselGameBox', 'Featured', 'Thumbnail'];
    for (const type of PREF) {
        const img = keyImages.find((k) => k.type === type);
        if (img?.url) return img.url;
    }
    return null;
}

function _pickEpicLogo(keyImages) {
    if (!Array.isArray(keyImages) || keyImages.length === 0) return null;
    const PREF = ['DieselLogo', 'Logo', 'OfferLogo'];
    for (const type of PREF) {
        const img = keyImages.find((k) => k.type === type);
        if (img?.url) return img.url;
    }
    return null;
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

        // Primary source: `legendary list --json` returns only owned playable games.
        // Do NOT use --include-non-ac as the primary source; it leaks Fab/asset catalog entries.
        const rawPlayable = await runLegendary(['list', '--json'], confPath, 30_000);
        let playableParsed = JSON.parse(rawPlayable);
        if (!Array.isArray(playableParsed)) playableParsed = [];

        // Third-party source: EA App, Ubisoft, etc.
        let thirdPartyParsed = [];
        try {
            const rawThirdParty = await runLegendary(['list', '--json', '--third-party'], confPath, 30_000);
            thirdPartyParsed = JSON.parse(rawThirdParty);
            if (!Array.isArray(thirdPartyParsed)) thirdPartyParsed = [];
        } catch (_) { /* non-fatal */ }

        // Diagnostic-only: --include-non-ac (never merged into library).
        // Logged so we can see exactly what Legendary returns in that list.
        let nonAcParsed = [];
        try {
            const rawNonAc = await runLegendary(['list', '--json', '--include-non-ac'], confPath, 30_000);
            nonAcParsed = JSON.parse(rawNonAc);
            if (!Array.isArray(nonAcParsed)) nonAcParsed = [];
        } catch (_) { /* non-fatal */ }

        // Classify every candidate with the strict positive-game classifier.
        // Unknown entries (no positive game signal) are dropped by default.
        const candidates = [...playableParsed, ...thirdPartyParsed];
        const keptEntries     = [];
        const rejectedEntries = [];
        const unknownEntries  = [];

        for (const entry of candidates) {
            const result = classifyEpicEntry(entry);
            if (result.decision === 'keep') {
                keptEntries.push(entry);
            } else if (result.decision === 'unknown') {
                unknownEntries.push({ entry, reason: result.reason });
            } else {
                rejectedEntries.push({ entry, reason: result.reason });
            }
        }

        // Deduplicate kept entries by app_name.
        const seenAppNames = new Set();
        const allEntries   = keptEntries.filter(e => {
            if (seenAppNames.has(e.app_name)) return false;
            seenAppNames.add(e.app_name);
            return true;
        });
        const rawGamesCount = allEntries.length;

        _pushPlatformSyncLog('epic', 'info', 'Legendary Epic classification summary', {
            accountId:         aid,
            accountName:       acc.displayName,
            playableReturned:  playableParsed.length,
            thirdPartyReturned: thirdPartyParsed.length,
            nonAcReturned:     nonAcParsed.length,
            keptCount:         rawGamesCount,
            rejectedCount:     rejectedEntries.length,
            unknownCount:      unknownEntries.length,
            nonAcSample:       nonAcParsed.slice(0, 20).map(summarizeEpicEntryForLog),
            rejectedSample:    rejectedEntries.slice(0, 20).map(x => ({ ...summarizeEpicEntryForLog(x.entry), reason: x.reason })),
            unknownSample:     unknownEntries.slice(0, 20).map(x => ({ ...summarizeEpicEntryForLog(x.entry), reason: x.reason })),
        });

        const games = await buildEpicOwnedGameEntries(acc, allEntries);
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
        _pushPlatformSyncLog('epic', 'info',
            `Fetched ${rawGamesCount} games for ${acc.displayName} (kept=${rawGamesCount} rejected=${rejectedEntries.length} unknown=${unknownEntries.length})`, {
            accountId: aid,
            accountName: acc.displayName,
        });

        const classificationReport = {
            accountId:   aid,
            accountName: acc.displayName,
            keptCount:   rawGamesCount,
            rejectedCount: rejectedEntries.length,
            unknownCount:  unknownEntries.length,
            kept:     allEntries.map(e => ({ app_name: e.app_name, app_title: e.app_title || e.title, reason: 'positive_game_signal' })),
            rejected: rejectedEntries.map(x => ({ app_name: x.entry?.app_name, app_title: x.entry?.app_title || x.entry?.title, reason: x.reason })),
            unknown:  unknownEntries.map(x => ({ app_name: x.entry?.app_name, app_title: x.entry?.app_title || x.entry?.title, reason: x.reason })),
            nonAcDiagnostic: nonAcParsed.map(summarizeEpicEntryForLog),
        };

        // DB cleanup: permanently delete previously-imported non-game entries.
        const badEntries = [...rejectedEntries, ...unknownEntries].map(x => x.entry);
        if (badEntries.length > 0) {
            try {
                await gamesSyncAdapter.removeEpicNonGameEntries(badEntries);
            } catch (cleanupErr) {
                _pushPlatformSyncLog('epic', 'warn', `DB cleanup error: ${cleanupErr.message}`, { accountId: aid });
            }
        }

        return { aid, games, result, classificationReport };
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
        return syncCacheRepository.isEpicLinked();
    },
    getAccounts() {
        const raw = syncCacheRepository.readEpicAccountsSync();
        if (!Array.isArray(raw)) return [];
        return raw.filter(a => a?.id).map(a => {
            // Sanitize accounts saved with an epic_tmp fallback id or display name
            const idStr = String(a.id);
            const nameStr = String(a.displayName || '');
            if (idStr.startsWith('epic_tmp') || /^epic_tmp/i.test(nameStr) || /^epic epic_tmp/i.test(nameStr)) {
                syncWarn('[EpicAccounts] Found unresolved epic_tmp account, marking as needs_reauth:', idStr);
                return { ...a, displayName: 'Reconnect Epic account', needsReauth: true };
            }
            return a;
        });
    },
    async link(parentWindow, emitState = () => {}, opts = {}) {
        await ensureDirs();
        emitState('waiting_for_signin', 'Waiting for Epic authorization. This can take a few seconds.');
        const authCode = await openEpicLoginWindow(parentWindow);
        emitState('resolving_identity', 'Reading your Epic account profile...');
        const tmpId = `epic_tmp_${Date.now()}`;
        const confPath = getLegendaryConfPath(tmpId);
        await fs.mkdir(confPath, { recursive: true });
        try {
            await runLegendary(['auth', '--code', authCode], confPath);

            // Read Legendary's user.json directly — more reliable than status --json
            // for account_id and display_name fields.
            let legendaryUser = null;
            try {
                legendaryUser = JSON.parse(await fs.readFile(path.join(confPath, 'user.json'), 'utf8'));
                syncLog('[Epic Link] user.json account_id:', legendaryUser?.account_id, 'display_name:', legendaryUser?.display_name);
            } catch {}

            let statusRaw = {};
            try {
                statusRaw = JSON.parse(await runLegendary(['status', '--json'], confPath));
            } catch {}
            syncLog('[Epic Link] legendary status raw (first 500):', redactSecrets(String(JSON.stringify(statusRaw)).slice(0, 500)));

            // Merge user.json data for more reliable identity resolution
            const status = {
                ...statusRaw,
                account_id:   legendaryUser?.account_id   || statusRaw?.account_id,
                display_name: legendaryUser?.display_name || statusRaw?.display_name,
            };

            emitState('saving_account', 'Saving linked Epic account...');

            // Check existing accounts so we can fall back to a saved name.
            const existingAccounts = await getEpicAccountsList().catch(() => []);
            const identity = resolveEpicAccountIdentity(status, null, tmpId);
            const { accountId, displayName, confidence } = identity;

            // Guard: if we still ended up with the tmp fallback id, auth succeeded but
            // Legendary did not expose the real account_id — abort so we don't persist garbage.
            if (String(accountId) === String(tmpId) || String(accountId).startsWith('epic_tmp')) {
                throw new Error(
                    'Could not resolve your Epic account ID from Legendary. ' +
                    'Please try linking your account again.'
                );
            }

            const existingEntry = existingAccounts.find(a => String(a.id) === String(accountId));
            const _isBadName = (n) => !n || /^epic user$/i.test(n) || /^Epic [0-9a-f]{6,8}$/i.test(n)
                || /^epic_tmp/i.test(n) || /^epic epic_tmp/i.test(n);
            // Use resolved name if it's real; fall back to previously-saved valid name.
            const finalDisplayName = !_isBadName(displayName) ? displayName
                : (!_isBadName(existingEntry?.displayName) ? existingEntry.displayName
                    : (displayName || 'Epic Account'));

            syncLog('[Epic Link] Resolved → id=' + accountId + ' name=' + finalDisplayName + ' confidence=' + confidence);
            const realConfPath = getLegendaryConfPath(accountId);
            if (confPath !== realConfPath) {
                await fs.rename(confPath, realConfPath).catch(async () => {
                    await fs.cp(confPath, realConfPath, { recursive: true });
                    await fs.rm(confPath, { recursive: true, force: true });
                });
            }
            let accounts = await getEpicAccountsList();
            const existingIdx = accounts.findIndex(a => String(a.id) === String(accountId));
            if (existingIdx === -1) {
                accounts.push({ id: accountId, displayName: finalDisplayName });
            } else {
                // Upgrade any invalid/fallback display name to the newly resolved real name.
                const old = accounts[existingIdx].displayName;
                if (_isBadName(old)) {
                    accounts[existingIdx].displayName = finalDisplayName;
                }
            }
            await saveEpicAccountsList(accounts);
            // Only write sync_link.json to an already-existing real switcher profile.
            // Never create a new folder — that would cause the account to silently
            // appear in the Epic Account Switcher after a library-only sync.
            const matchingProfile = await _findMatchingEpicSwitcherProfile(accountId, finalDisplayName);
            if (matchingProfile) {
                await _writeSyncLinkToExistingSwitcherProfile('epic', matchingProfile, accountId, { epicDisplayName: finalDisplayName });
            } else {
                syncLog(`[Epic Link] No existing switcher profile matches "${finalDisplayName}"; sync_link skipped.`);
            }
            emitState('linked', `Epic account linked as ${finalDisplayName}.`, { displayName: finalDisplayName, accountId });
            analytics.logPlatformLinked('epic').catch(() => {});
            return { displayName: finalDisplayName, accountId, epicAccountId: accountId };
        } catch (err) {
            await fs.rm(confPath, { recursive: true, force: true }).catch(()=>{});
            throw err;
        }
    },
    async syncLibrary(targetAccountId = null) {
        await ensureDirs();
        const accounts = await getEpicAccountsList();
        if (accounts.length === 0) throw new Error('No Epic accounts linked.');

        const rawPreviousGames = await this.getCachedLibrary();
        // Evict any non-game entries (Fab, Blueprint CSV Parsing, etc.) that
        // may have been cached by an earlier version of the sync pipeline.
        const previousGames = rawPreviousGames.filter(isEpicSyncedGameAllowed);
        if (rawPreviousGames.length !== previousGames.length) {
            _pushPlatformSyncLog('epic', 'info',
                `Evicted ${rawPreviousGames.length - previousGames.length} cached non-game Epic entries from previous sync`);
        }

        // ── Ownership-safe merge seed ─────────────────────────────────────
        // Always start mergedLibrary from the full previous cache.
        //
        // For a full sync this is a no-op functionally: every account is
        // re-synced so all games will be overwritten with fresh data anyway.
        //
        // For a partial sync (targetAccountId is set) this is the critical
        // fix: non-target accounts' games and their ownership metadata on
        // shared games survive in the map before we apply fresh data on top.
        // This replaces the old "only preserve games not owned by target"
        // block, which stripped A's ownership from shared games when syncing B.
        const mergedLibrary = new Map(
            previousGames.map((g) => [g.id, JSON.parse(JSON.stringify(g))])
        );

        const accountResults = {};
        const classificationReports = [];
        let completedAccounts = 0;

        // If targeting a specific account, filter the list
        const accountsToSync = targetAccountId 
            ? accounts.filter(a => String(a.id) === String(targetAccountId))
            : accounts;

        if (accountsToSync.length === 0 && targetAccountId) {
            syncWarn(`[EpicSync] Target account ${targetAccountId} not found.`);
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
                if (item.classificationReport) classificationReports.push(item.classificationReport);

                // mergeOwnedGamesIntoLibrary merges fresh games into the map.
                // For games already seeded from previousGames (shared games),
                // the merge path adds the target account's id/name to the
                // existing entry — so shared games end up with ALL owners.
                // For new games introduced by this sync they are added fresh.
                mergeOwnedGamesIntoLibrary(mergedLibrary, item.games, item.account, 'epic');

                // For a partial sync, also repair any non-target ownership
                // that the merge above may have lost (e.g. display names that
                // are duplicated differently).  This is a safety pass that
                // re-applies cached non-target ownership onto shared games.
                if (targetAccountId) {
                    const targetAid = String(targetAccountId);
                    for (const freshGame of item.games) {
                        const cached = previousGames.find((p) => p.id === freshGame.id);
                        if (!cached) continue;
                        const merged = mergedLibrary.get(freshGame.id);
                        if (!merged) continue;
                        mergeExistingEpicOwnership(merged, cached, targetAid);
                    }
                }

                // NOTE: metadata sync is deferred to the single post-finalization call on finalGames.
            }

            const finalized = finalizeLibraryForAccounts({
                platform: 'epic',
                previousGames,
                nextGames: Array.from(mergedLibrary.values()),
                accounts: accountsToSync,
                accountResults,
            });
            // Cache cleanup: remove any Fab/marketplace entries that survived
            // from a previous sync before the filter was in place.
            const rawFinalGames = finalized.games;
            const finalGames = rawFinalGames.filter(isEpicSyncedGameAllowed);
            const cleanedCount = rawFinalGames.length - finalGames.length;
            if (cleanedCount > 0) {
                _pushPlatformSyncLog('epic', 'info',
                    `Evicted ${cleanedCount} cached non-game Epic entries during cleanup`);
            }

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

            await syncCacheRepository.writeEpicMergedLibrary(finalGames);

            // ── Cover-first image caching (fire-and-forget) ───────────────────
            if (_platformSyncAssetDownloader) {
                const _cfWin = _platformSyncWindowGetter?.();
                cacheLibraryCoversFirst(
                    finalGames, _platformSyncAssetDownloader, EPIC_MERGED_CACHE,
                    (lib, e) => lib.findIndex(lg => lg.namespace === e.namespace || lg.appName === e.appName),
                    null,
                    {
                        coverCachedEmitter: (payload) => {
                            if (_cfWin && !_cfWin.isDestroyed()) {
                                _cfWin.webContents.send('all-games-cover-cached', payload);
                            }
                        },
                    }
                ).catch(e => syncWarn('[CoverFirst] epic error:', e.message));
            }

            // ── Write classification report (non-blocking) ────────────────────
            syncCacheRepository.writeEpicClassificationReport({
                generatedAt: new Date().toISOString(),
                accounts: classificationReports,
            }).catch(err =>
                _pushPlatformSyncLog('epic', 'warn', `Failed to write classification report: ${err.message}`)
            );

            // ── Send to Baddel server in background ──────────────────────────
            _pushPlatformSyncLog('epic', 'info', 'Sending library to Baddel server...');
            _importLibraryToServer('epic', finalGames).catch(err =>
                _pushPlatformSyncLog('epic', 'warn', `Baddel server import failed: ${err.message}`)
            );

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
            analytics.logSyncCompleted('epic', finalGames.length, accountsToSync.length).catch(() => {});
            return finalGames;
        } catch (err) {
            _finishPlatformSync('epic', {
                phase: 'error',
                statusText: `Epic sync failed: ${err.message}`,
                lastError: err.message,
            });
            _pushPlatformSyncLog('epic', 'error', `Epic sync crashed: ${err.message}`);
            analytics.logSyncFailed('epic', err.message).catch(() => {});
            throw err;
        }
    },
    async getCachedLibrary() {
        return syncCacheRepository.readEpicMergedLibrary();
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
            await syncCacheRepository.deleteEpicMergedLibrary();
        } else if (removedAccount) {
            const cachedGames = await this.getCachedLibrary();
            const filteredGames = removeAccountFromLibrary('epic', cachedGames, removedAccount);
            await syncCacheRepository.writeEpicMergedLibrary(filteredGames);
        }
        analytics.logPlatformUnlinked('epic').catch(() => {});
    },
};

// ─── IPC Handler Registry ────────────────────────────────────

async function _cleanupEpicTmpConfigs() {
    try {
        const userData = app.getPath('userData');
        const entries = await fs.readdir(userData).catch(() => []);
        await Promise.all(
            entries
                .filter((e) => /^legendary-config-epic_tmp_/i.test(e))
                .map((e) => {
                    const dir = path.join(userData, e);
                    syncLog('[EpicLink] Cleaning up orphaned tmp config dir:', e);
                    return fs.rm(dir, { recursive: true, force: true }).catch(() => {});
                })
        );
    } catch {}
}

function registerPlatformSyncHandlers(ipcMainRef, getMainWindow) {
    _platformSyncWindowGetter = getMainWindow;

    // Clean up any orphaned legendary tmp config dirs from interrupted link flows
    _cleanupEpicTmpConfigs().catch(() => {});

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

    ipcMainRef.handle('platform-sync:link', async (event, platform, opts = {}) => {
        const mainWin = getMainWindow?.();
        const parentWindow = BrowserWindow.fromWebContents(event.sender) || mainWin || BrowserWindow.getFocusedWindow();
        try {
            const connector = connectors[platform];
            if (!connector) throw new Error(`Unsupported platform: ${platform}`);
            syncLog(`[PlatformSync] Linking platform: ${platform} addToSwitcher=${!!opts?.addToSwitcher}`);
            const emitState = (status, message, extra = {}) =>
                _emitLinkState(parentWindow, platform, status, message, extra);
            const linkRes = await connector.link(parentWindow, emitState, opts);
            if (typeof linkRes === 'string') return { status: 'success', displayName: linkRes };
            return { status: 'success', ...linkRes };
        } catch (err) {
            console.error('[PlatformSync] Link error:', err);
            _emitLinkState(parentWindow, platform, 'failed', err.message || 'Link failed');
            return {
                status: 'error',
                code: err.code || err.name || 'PLATFORM_LINK_FAILED',
                message: err.message || 'Failed to link account.',
            };
        }
    });

    ipcMainRef.handle('platform-sync:sync', safeHandle(async (_e, platform, accountId) => {
        const connector = connectors[platform];
        if (!connector) throw new Error(`Unsupported platform: ${platform}`);

        const currentState = _getPlatformSyncState(platform);
        if (currentState.isSyncing) return { alreadyRunning: true };

        if (typeof connector.getAccounts === 'function') {
            const accounts = connector.getAccounts();
            if (!accounts || accounts.length === 0) throw new Error(`No ${platform} accounts linked.`);
        }

        // Fire and forget — results flow back via platform-sync:state / completed / failed events
        connector.syncLibrary(accountId).catch(err => {
            console.error(`[PlatformSync] Background sync for ${platform} ended with error:`, err.message);
        });

        return { status: 'started' };
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


/**
 * Send synced library to Baddel metadata server using the batch endpoint.
 * Runs in background after sync completes — never blocks the UI.
 *
 * Strategy:
 *  1. Build a deduplicated payload from all synced games (platform+id key).
 *  2. Chunk into pages of MAX_BATCH_PAGE items (≤ 200, the server hard cap).
 *  3. Send pages sequentially with a short inter-page delay (400 ms).
 *  4. On HTTP 429: respect Retry-After if present, else bounded exponential
 *     backoff (base 10 s × 2^attempt, cap 120 s, ±20 % jitter). Retry the
 *     same page up to MAX_BATCH_RETRIES times before giving up on that page.
 *  5. Per-item statuses from 207 body are tallied across all pages.
 *  6. After all pages are submitted, run lookup+apply for games that came
 *     back as needs_enrich or already_exists (server already has data).
 *  7. For games that were created_and_queued, poll after a delay so images
 *     appear in the library card once the server has enriched them.
 *
 * @param {'steam'|'epic'} platform
 * @param {object[]} games - synced game entries from local cache
 */
async function _importLibraryToServer(platform, games) {
    const serverImportService = new PlatformSyncServerImportService({
        baddelApi,
        syncCacheRepository,
        enqueueWrite: _enqueueLibraryWrite,
        emitLibraryUpdated: _emitLibraryUpdated,
        getWindow: () => _platformSyncWindowGetter?.(),
        getAssetDownloader: () => _platformSyncAssetDownloader,
        sleep: (ms) => new Promise(r => setTimeout(r, ms)),
        random: Math.random,
        logger: {
            log: (...args) => syncLog(...args),
            warn: (...args) => syncWarn(...args),
            consoleLog: (...args) => console.log(...args),
            consoleWarn: (...args) => console.warn(...args),
        },
        mapWithConcurrency,
    });

    return serverImportService.importLibraryToServer(platform, games);
}
// ─── Startup auto-sync ───────────────────────────────────────
// Called from main.js after the window shows. Fires background syncs for any
// platform that has linked accounts and is not already syncing.
async function autoSyncOnStartup() {
    const platformsToSync = [];
    for (const [platform, connector] of Object.entries(ALL_CONNECTORS)) {
        try {
            const accounts = connector?.getAccounts?.();
            if (!Array.isArray(accounts) || accounts.length === 0) continue;
            const state = _getPlatformSyncState(platform);
            if (state?.isSyncing) continue;
            platformsToSync.push(platform);
            console.log(`[AutoSync] Starting background ${platform} sync…`);
            connector.syncLibrary().catch(err => {
                console.error(`[AutoSync] ${platform} sync failed:`, err.message);
            });
        } catch (err) {
            console.error(`[AutoSync] ${platform} account check error:`, err.message);
        }
    }
    if (platformsToSync.length > 0) {
        analytics.logAutoSyncStarted(platformsToSync).catch(() => {});
    }
}

// ─── Exports ─────────────────────────────────────────────────

module.exports = createPlatformSyncFeature({
    registerPlatformSyncHandlers,
    epicConnector,
    steamConnector,
    enrichProfilesWithSyncData,
    registerPlatformSyncAssetDownloader,
    autoSyncOnStartup,
    _mobileApprovalPollStep,
    _startQrLoginFlow,
    cacheLibraryCoversFirst,
    _withConcurrency,
    // Exported for testing only — not part of the public API
    _writeSyncLinkToExistingSwitcherProfile,
    _findMatchingEpicSwitcherProfile,
});
