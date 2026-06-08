const { app, BrowserWindow, ipcMain, shell, Tray, Menu, dialog, session, protocol, Notification, screen } = require('electron');
let autoUpdater = null; // lazy-loaded inside setupAutoUpdater() — never required at module load
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const os = require('os');
const { exec, spawn } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const { BrowserView, WebContentsView } = require('electron');

const {
    scanAllGames, addManualGame, getSavedGames, updateGameImage, resetGameImage,
    removeGame, renameGame, unhideAllGames, getHiddenGames,
    restoreSpecificGames, deleteGamePermanently, reorderLibrary,
    updateGameMetadata, saveFullMetadata, loadFullMetadata,
    updatePlaytime, setTimeTrackingEnabled, getTimeTrackingEnabled,
} = require('./gameScanner');
const colHandler      = require('./collectionsHandler');
const baddelApi       = require('./services/baddelApi');
const imageWebpCache  = require('./services/imageWebpCache');
const { generateMetadataCandidates } = require('./services/candidateGenerator');
const { registerAccountHandlers, switchAccountByPlatform } = require('./accountsHandler');
const accountShortcuts = require('./services/accountShortcuts');
const quickSwitcher = require('./services/quickSwitcher');
const quickSwitcherSettings = require('./services/quickSwitcherSettings');
const { registerPlatformSyncHandlers, steamConnector, epicConnector, registerPlatformSyncAssetDownloader, autoSyncOnStartup } = require('./platformSync');
const analytics = require('./analytics');
const psList = require('ps-list');
const https = require('https');
const steamBridge = require('./steamBridge');
const { fileURLToPath } = require('url');
const safeLauncher  = require('./services/safeLauncher');
const ipcValidation = require('./services/ipcValidation');


// One achievement fetch at a time — avoids overlapping authenticate/get_achievements on the single Python bridge.
let _achievementIpcChain = Promise.resolve();
function _enqueueAchievementFetch(fn) {
    const next = _achievementIpcChain.then(fn, fn);
    _achievementIpcChain = next.catch(() => {});
    return next;
}

// ============================================================
// AUTO UPDATER — state machine (initialised inside app.whenReady)
// ============================================================
// ⚠️  Do NOT call autoUpdater.setFeedURL / attach listeners here at module-load
//     time.  electron-updater v6 reads app.getAppPath()/package.json synchronously
//     during initialisation; if the asar is still being replaced right after an
//     NSIS update the file is transiently missing → "ENOENT package.json" crash
//     before the window ever opens.  All setup is deferred to setupAutoUpdater()
//     which is called from inside app.whenReady().

// status: idle | checking | available | preparing | downloading | downloaded | error
const _updState = {
    status:       'idle',
    version:      null,
    downloading:  false,
    downloaded:   false,
    prepareTimer: null,
    stallTimer:   null,   // reset on every download-progress; fires if progress stops for 120 s
};

// ── Update notes — show once per installed version ────────────────────────────

const UPDATE_NOTES_STATE_FILE = path.join(app.getPath('userData'), 'update-notes-state.json');

function readUpdateNotesState() {
    try {
        return JSON.parse(fsSync.readFileSync(UPDATE_NOTES_STATE_FILE, 'utf8'));
    } catch {
        return {};
    }
}

function writeUpdateNotesState(state) {
    try {
        fsSync.writeFileSync(UPDATE_NOTES_STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
    } catch (err) {
        console.warn('[UpdateNotes] Failed to write state:', err?.message || err);
    }
}

// Keep this map updated for every release.
// The modal only shows when pendingVersion === app.getVersion()
// and that version has not been marked as shown.
function getUpdateNotesForVersion(version) {
    const notesByVersion = {
        '1.1.2': {
            version: '1.1.2',
            title: 'Baddel has been updated',
            subtitle: "Here's what's new in this version.",
            items: [
                {
                    title: 'Manual game launching is now more reliable.',
                    description: 'Games added manually now open using the same behavior as Windows double-click.'
                },
                {
                    title: 'Added Community & Socials.',
                    description: 'You can now find our official Discord, Instagram, X, LinkedIn, and TikTok channels inside the launcher.'
                }
            ],
            footer: 'Thanks for using Baddel.'
        },
        '1.1.3': {
            version: '1.1.3',
            title: 'Baddel just got better',
            subtitle: "Here's what changed in this update.",
            items: [
                {
                    title: 'Smoother Riot launches',
                    description: "Riot games now open without Baddel showing a fake launch error."
                },
                {
                    title: 'EA games open the right way',
                    description: "EA games now use the game's real launch path when available, instead of relying on a Windows link that may not work on every PC."
                },
                {
                    title: 'Startup setting is more accurate',
                    description: 'The startup toggle now better matches your real Windows startup setting.'
                },
                {
                    title: 'Account Switcher is easier to understand',
                    description: 'Adding a new account now gives clearer steps, so players know when to sign in and when to save the account.'
                }
            ],
            footer: 'Thanks for using Baddel. More improvements are coming.'
        }
    };

    return notesByVersion[String(version)] || {
        version:  String(version || app.getVersion()),
        title:    'Baddel has been updated',
        subtitle: 'This version includes improvements, fixes, and performance updates.',
        items: [
            {
                title:       'Improvements and fixes.',
                description: 'Baddel has been updated with the latest fixes and improvements.'
            }
        ],
        footer: 'Thanks for using Baddel.'
    };
}

function markUpdateNotesPending(version) {
    if (!version) return;
    const state = readUpdateNotesState();
    writeUpdateNotesState({
        ...state,
        pendingVersion: String(version),
        fromVersion:    app.getVersion(),
        shownVersions:  Array.isArray(state.shownVersions) ? state.shownVersions : [],
        createdAt:      new Date().toISOString()
    });
    console.log('[UpdateNotes] Pending notes for version:', version);
}

function getPendingUpdateNotesPayload() {
    const state          = readUpdateNotesState();
    const currentVersion = app.getVersion();
    const pendingVersion = String(state.pendingVersion || '');

    console.log(`[UpdateNotes] getPendingUpdateNotesPayload: currentVersion=${currentVersion}, pendingVersion=${pendingVersion || '(none)'}`);

    if (!pendingVersion) {
        console.log('[UpdateNotes] skip: no pendingVersion stored');
        return null;
    }
    if (pendingVersion !== String(currentVersion)) {
        console.log(`[UpdateNotes] skip: pendingVersion (${pendingVersion}) !== currentVersion (${currentVersion})`);
        return null;
    }

    const shownVersions = Array.isArray(state.shownVersions)
        ? state.shownVersions.map(String)
        : [];

    if (shownVersions.includes(pendingVersion)) {
        console.log(`[UpdateNotes] skip: ${pendingVersion} already shown`);
        return null;
    }

    return getUpdateNotesForVersion(pendingVersion);
}

function markUpdateNotesShown(version) {
    const state = readUpdateNotesState();
    const v = String(version || app.getVersion());

    const shownVersions = new Set(
        Array.isArray(state.shownVersions) ? state.shownVersions.map(String) : []
    );
    shownVersions.add(v);

    writeUpdateNotesState({
        ...state,
        shownVersions:   Array.from(shownVersions),
        lastShownVersion: v,
        lastShownAt:     new Date().toISOString()
    });
    console.log('[UpdateNotes] Marked shown:', v);
}

let _updateInstallStarted = false;

function _sendUpdateStatus(payload) {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('update-status', payload);
    console.log('[AutoUpdater] status ->', payload.status, payload.message || payload.version || '');
}

function _clearPrepareTimer() {
    if (_updState.prepareTimer) {
        clearTimeout(_updState.prepareTimer);
        _updState.prepareTimer = null;
    }
}

function _clearStallTimer() {
    if (_updState.stallTimer) {
        clearTimeout(_updState.stallTimer);
        _updState.stallTimer = null;
    }
}

function _clearAllUpdateTimers() {
    _clearPrepareTimer();
    _clearStallTimer();
}

// Arm (or re-arm) the 120-second stall watchdog while downloading.
function _resetStallTimer() {
    _clearStallTimer();
    _updState.stallTimer = setTimeout(() => {
        if (_updState.status === 'downloading') {
            console.warn('[AutoUpdater] Stall timeout — no download progress for 120 s');
            _updState.downloading = false;
            _updState.status      = 'error';
            const msg = 'Download stalled. Check your connection and try again.';
            if (mainWindow) mainWindow.webContents.send('update-error', msg);
            _sendUpdateStatus({ status: 'error', message: msg });
        }
    }, 120_000);
}

// Called once from app.whenReady() — safe because app is fully initialised by then.
function setupAutoUpdater() {
    try {
        // Lazy-load electron-updater here, never at module load time.
        // electron-updater v6 reads package.json synchronously on require(); if the
        // asar is still being swapped after an NSIS update that file may be transiently
        // missing -> "ENOENT package.json" crash before the window ever opens.
        if (!autoUpdater) {
            ({ autoUpdater } = require('electron-updater'));
        }

        autoUpdater.setFeedURL({
            provider: 'github',
            owner:    'Seif-eldeen-hassan',
            repo:     'Baddel-Releases',
        });
        autoUpdater.autoDownload = false;
        autoUpdater.allowDowngrade = false;

        // ── events ───────────────────────────────────────────────────────────

        autoUpdater.on('update-available', (info) => {
            console.log('[AutoUpdater] Update available:', info.version);
            _updState.version = info.version;
            _updState.status  = 'available';
            if (mainWindow) mainWindow.webContents.send('update-found', info.version);
            _sendUpdateStatus({ status: 'available', version: info.version });
        });

        autoUpdater.on('update-not-available', () => {
            console.log('[AutoUpdater] No update available');
            _updState.status = 'idle';
            if (mainWindow) mainWindow.webContents.send('update-not-found');
        });

        autoUpdater.on('download-progress', (progress) => {
            _clearPrepareTimer();
            _resetStallTimer();           // re-arm stall watchdog on every progress tick
            _updState.status      = 'downloading';
            _updState.downloading = true;
            const payload = {
                percent:        Math.round(progress.percent),
                transferred:    progress.transferred,
                total:          progress.total,
                bytesPerSecond: progress.bytesPerSecond,
            };
            console.log(`[AutoUpdater] Progress: ${payload.percent}%`);
            if (mainWindow) mainWindow.webContents.send('update-download-progress', payload);
            _sendUpdateStatus({ status: 'downloading', progress: payload });
        });

        autoUpdater.on('update-downloaded', (info) => {
            console.log('[AutoUpdater] Downloaded:', info.version);
            _clearAllUpdateTimers();
            _updState.status      = 'downloaded';
            _updState.downloaded  = true;
            _updState.downloading = false;
            _updState.version     = info.version;
            // Persist immediately so the version survives a restart before the user clicks "Restart now".
            markUpdateNotesPending(info.version);
            if (mainWindow) mainWindow.webContents.send('update-ready', info.version);
            _sendUpdateStatus({ status: 'downloaded', version: info.version });
        });

        autoUpdater.on('error', (err) => {
            console.error('[AutoUpdater] Error:', err.message);
            _clearAllUpdateTimers();
            _updState.status      = 'error';
            _updState.downloading = false;
            const msg = err?.message || String(err);
            if (mainWindow) mainWindow.webContents.send('update-error', msg);
            _sendUpdateStatus({ status: 'error', message: msg });
        });

        console.log('[AutoUpdater] Initialised — current version:', app.getVersion());
    } catch (err) {
        // Non-fatal: log but don't crash the app if auto-updater can't initialise
        console.error('[AutoUpdater] Failed to initialise (non-fatal):', err.message);
    }
}

// ---- Image/cache handlers (moved to handlers/imageHandlers.js) ----
require('./handlers/imageHandlers').register(ipcMain, {
    app, path, fs, dialog, imageWebpCache, ipcValidation, fileURLToPath,
    getSavedGames, getMainWindow: () => mainWindow,
    _collectImageCacheIdsFromGame, _readReadyToInstallProtectedImageIds,
    IMAGE_CACHE_PRUNE_GRACE_MS, updateGameImage, resetGameImage,
});

// ── IPC: start download — handle (invoke) so renderer gets immediate feedback ──
ipcMain.handle('start-update-download', async () => {
    console.log('[AutoUpdater] Download requested — current status:', _updState.status);

    if (_updState.downloaded) {
        console.log('[AutoUpdater] Already downloaded, re-sending update-ready');
        if (mainWindow) mainWindow.webContents.send('update-ready', _updState.version);
        _sendUpdateStatus({ status: 'downloaded', version: _updState.version });
        return { ok: true, status: 'downloaded' };
    }

    if (_updState.downloading) {
        console.log('[AutoUpdater] Download already in progress:', _updState.status);
        _sendUpdateStatus({ status: _updState.status, version: _updState.version });
        return { ok: true, status: _updState.status };
    }

    _updState.downloading = true;
    _updState.status      = 'preparing';
    console.log('[AutoUpdater] Starting download…');
    _sendUpdateStatus({ status: 'preparing', version: _updState.version });

    // Safety timeout — if download-progress never fires within 60 s, surface an error
    _clearPrepareTimer();
    _updState.prepareTimer = setTimeout(() => {
        if (_updState.status === 'preparing') {
            console.warn('[AutoUpdater] Prepare timeout — no progress after 60 s');
            _updState.downloading = false;
            _updState.status      = 'error';
            const msg = 'Download did not start. Check your connection and try again.';
            if (mainWindow) mainWindow.webContents.send('update-error', msg);
            _sendUpdateStatus({ status: 'error', message: msg });
        }
    }, 60_000);

    try {
        if (!autoUpdater) throw new Error('autoUpdater failed to initialise — cannot download update');
        await autoUpdater.downloadUpdate();
        console.log('[AutoUpdater] downloadUpdate() resolved');
        return { ok: true };
    } catch (err) {
        _clearAllUpdateTimers();
        _updState.downloading = false;
        _updState.status      = 'error';
        const msg = err?.message || String(err);
        console.error('[AutoUpdater] downloadUpdate() rejected:', msg);
        if (mainWindow) mainWindow.webContents.send('update-error', msg);
        _sendUpdateStatus({ status: 'error', message: msg });
        return { ok: false, error: msg };
    }
});

// Legacy send shim — keeps any old callers from crashing
ipcMain.on('start-update-download', () => {
    console.warn('[AutoUpdater] Legacy ipcMain.on start-update-download — use invoke instead');
    if (_updState.downloaded) { if (mainWindow) mainWindow.webContents.send('update-ready', _updState.version); return; }
    if (_updState.downloading) return;
    if (!autoUpdater) {
        console.error('[AutoUpdater] (legacy) autoUpdater not initialised — cannot download');
        return;
    }
    autoUpdater.downloadUpdate().catch(err => {
        console.error('[AutoUpdater] (legacy) Download failed:', err.message);
        if (mainWindow) mainWindow.webContents.send('update-error', err.message);
    });
});

// اليوزر وافق على الـ restart
ipcMain.on('restart-and-update', () => {
    if (_updateInstallStarted) {
        console.warn('[AutoUpdater] restart-and-update ignored — install already started');
        return;
    }

    _updateInstallStarted = true;

    if (!autoUpdater) {
        console.error('[AutoUpdater] quitAndInstall skipped — autoUpdater not initialised');
        _updateInstallStarted = false;
        return;
    }

    console.log('[AutoUpdater] restart-and-update requested');

    isQuitting = true;

    try {
        if (tray) {
            tray.destroy();
            tray = null;
        }
    } catch (err) {
        console.warn('[AutoUpdater] tray destroy failed:', err?.message || err);
    }

    try {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.removeAllListeners('close');
        }
    } catch {}

    // Use the version saved by update-downloaded as first fallback; never fall back to
    // autoUpdater.currentVersion (the OLD running version) — that would poison pendingVersion.
    const savedState    = readUpdateNotesState();
    const targetVersion = _updState.version || savedState.pendingVersion || null;
    if (targetVersion) {
        markUpdateNotesPending(targetVersion);
    } else {
        console.warn('[UpdateNotes] restart-and-update: no target version found — update notes will not show');
    }

    setTimeout(() => {
        try {
            console.log('[AutoUpdater] calling quitAndInstall...');
            autoUpdater.quitAndInstall(false, true);
        } catch (err) {
            _updateInstallStarted = false;
            console.error('[AutoUpdater] quitAndInstall failed:', err?.message || err);
        }
    }, 1000);
});



// ============================================================
// GLOBALS
// ============================================================
let mainWindow;
let tray = null;
let isQuitting = false;

const driveCache = { data: null, lastFetched: 0 };
const DRIVE_CACHE_TTL = 60_000;
const IMAGE_CACHE_PRUNE_GRACE_MS = 24 * 60 * 60 * 1000;

function _safeImageCacheId(value) {
    return String(value ?? '').trim().replace(/[^a-zA-Z0-9_\-]/g, '_');
}

function _addImageCacheIdVariants(out, value, platform) {
    const raw = String(value ?? '').trim();
    if (!raw || raw === 'null' || raw === 'undefined') return;

    const variants = new Set([raw, _safeImageCacheId(raw)]);
    const cleanPlatform = String(platform || '').trim().toLowerCase();
    if (cleanPlatform) {
        variants.add(`${cleanPlatform}_${raw}`);
        variants.add(`${cleanPlatform}-${raw}`);
        variants.add(_safeImageCacheId(`${cleanPlatform}_${raw}`));
        variants.add(_safeImageCacheId(`${cleanPlatform}-${raw}`));
    }

    const prefixed = /^(steam|epic|ea|ubisoft|xbox|riot|discord|rockstar)[_-](.+)$/i.exec(raw);
    if (prefixed?.[2]) {
        variants.add(prefixed[2]);
        variants.add(_safeImageCacheId(prefixed[2]));
    }

    for (const id of variants) {
        if (id) {
            out.add(id);
            out.add(String(id).toLowerCase());
        }
    }
}

function _collectImageCacheIdsFromGame(game, out) {
    if (!game || typeof game !== 'object') return;
    const platform = game.platform || game.source || game._platform || game.store || game.client || game.launcher;
    for (const field of ['id', 'appId', 'appid', 'app_id', 'gameId', 'game_id', 'appName']) {
        _addImageCacheIdVariants(out, game[field], platform);
    }
    if (game.allIds && typeof game.allIds === 'object') {
        for (const [p, id] of Object.entries(game.allIds)) {
            _addImageCacheIdVariants(out, id, p || platform);
        }
    }
    if (game._raw && game._raw !== game) _collectImageCacheIdsFromGame(game._raw, out);
}

function _walkPlatformLibraryEntries(node, visit) {
    if (!node) return;
    if (Array.isArray(node)) {
        for (const item of node) _walkPlatformLibraryEntries(item, visit);
        return;
    }
    if (typeof node !== 'object') return;

    if (node.id || node.appId || node.appid || node.app_id || node.allIds || node.appName) visit(node);
    for (const key of ['games', 'library', 'items', 'ownedGames', 'entries', 'data', 'merged', 'apps']) {
        if (node[key]) _walkPlatformLibraryEntries(node[key], visit);
    }
}

function _readReadyToInstallProtectedImageIds(userDataPath) {
    const protectedIds = new Set();
    try {
        const fsSync = require('fs');
        const syncDir = path.join(userDataPath, 'platform-sync');
        if (!fsSync.existsSync(syncDir)) return protectedIds;

        const files = fsSync.readdirSync(syncDir)
            .filter(name => /_library_merged\.json$/i.test(name));
        for (const file of files) {
            try {
                const parsed = JSON.parse(fsSync.readFileSync(path.join(syncDir, file), 'utf8'));
                _walkPlatformLibraryEntries(parsed, (entry) => _collectImageCacheIdsFromGame(entry, protectedIds));
            } catch (err) {
                console.warn(`[ImageCachePrune] Could not read ${file}:`, err.message);
            }
        }
    } catch (err) {
        console.warn('[ImageCachePrune] Could not read platform-sync libraries:', err.message);
    }
    return protectedIds;
}

// ============================================================
// STARTUP LAUNCH MODE DETECTION
// ============================================================
const _startupArgv = process.argv.map(a => String(a).toLowerCase());
const isStartupLaunch =
    _startupArgv.includes('--hidden') ||
    _startupArgv.includes('--startup') ||
    _startupArgv.includes('--autostart');

console.log('[Startup] isStartupLaunch:', isStartupLaunch, 'argv:', process.argv);

// ============================================================
// SINGLE INSTANCE LOCK
// ============================================================
const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
    app.quit();
} else {
    app.on('second-instance', (_event, secondArgv) => {
        const secondIsStartup = secondArgv.some(a =>
            ['--hidden', '--startup', '--autostart'].includes(String(a).toLowerCase())
        );
        if (secondIsStartup) {
            console.log('[Startup] ignored second startup instance');
            return;
        }
        if (!mainWindow) return;
        if (mainWindow.isMinimized()) mainWindow.restore();
        if (!mainWindow.isVisible()) mainWindow.show();
        mainWindow.focus();
        mainWindow.setAlwaysOnTop(true);
        mainWindow.setAlwaysOnTop(false);
    });
}

// ============================================================
// ERROR HANDLING
// ============================================================
process.on('uncaughtException', (error) => {
    console.error('[Fatal][uncaughtException]', error);
    // Only show the error dialog when the window is visible — at boot-time
    // (isStartupLaunch) the window may not exist yet, so skip the dialog.
    if (!isStartupLaunch) {
        try { dialog.showErrorBox('Crashing Error', error.stack || error.message); } catch {}
    }
    process.exit(1);
});

process.on('unhandledRejection', (reason) => {
    console.error('[Fatal][unhandledRejection]', reason);
});

// ============================================================
// PLAYTIME TRACKER
// ============================================================

// ============================================================
// DYNAMIC GAME EXE SCANNER
// ============================================================
const dynamicExeCache = {};

async function getDynamicGameExes(gameId, gamePath) {
    // لو قرأنا الفولدر ده قبل كده، نرجع النتيجة من الكاش فوراً
    if (dynamicExeCache[gameId]) return dynamicExeCache[gameId];
    
    const exes = new Set();
    if (!gamePath || gamePath.length < 5) return [];

    try {
        const fsPromises = require('fs').promises;
        const path = require('path');
        const fsSync = require('fs');
        try {
            const stat = fsSync.statSync(gamePath);
            if (stat.isFile() && gamePath.toLowerCase().endsWith('.exe')) {
                dynamicExeCache[gameId] = [path.basename(gamePath).toLowerCase()];
                return dynamicExeCache[gameId];
            }
        } catch { /* fall through to directory scan */ }
        
        // قراءة الفولدر الرئيسي للعبة
        const items = await fsPromises.readdir(gamePath, { withFileTypes: true });
        
        for (const item of items) {
            if (item.isFile() && item.name.toLowerCase().endsWith('.exe')) {
                exes.add(item.name.toLowerCase());
            } else if (item.isDirectory()) {
                // البحث في المجلدات الفرعية الشهيرة اللي الشركات بتخبي فيها الـ exe
                const lowerDir = item.name.toLowerCase();
                if (['bin', 'binaries', 'win64', 'win32', 'core', 'retail'].some(sub => lowerDir.includes(sub))) {
                    try {
                        const subPath = path.join(gamePath, item.name);
                        const subItems = await fsPromises.readdir(subPath, { withFileTypes: true });
                        for (const subItem of subItems) {
                            if (subItem.isFile() && subItem.name.toLowerCase().endsWith('.exe')) {
                                exes.add(subItem.name.toLowerCase());
                            }
                        }
                    } catch(e) { /* تجاهل مجلدات النظام المحمية */ }
                }
            }
        }
    } catch(e) { /* تجاهل لو المسار غير موجود */ }
    
    // فلترة الملفات المساعدة (عشان لو في uninstaller شغال منعتبروش اللعبة)
    const validExes = [...exes].filter(exe => 
        !exe.includes('uninstall') && 
        !exe.includes('crash') && 
        !exe.includes('setup') && 
        !exe.includes('anticheat')
    );

    dynamicExeCache[gameId] = validExes;
    return validExes;
}

function getTrackingGame(gameId) {
    try {
        return (getSavedGames() || []).find(g => String(g.id) === String(gameId)) || null;
    } catch {
        return null;
    }
}

function collectExplicitExeCandidates(game = {}) {
    const names = new Set();
    const addName = (value) => {
        if (!value) return;
        const clean = path.basename(String(value).replace(/"/g, '').trim()).toLowerCase();
        if (clean.endsWith('.exe')) names.add(clean);
    };
    addName(game.executablePath);
    addName(game.command);
    addName(game.launchCommand);
    (Array.isArray(game.executablePaths) ? game.executablePaths : []).forEach(addName);
    (Array.isArray(game.exeCandidates) ? game.exeCandidates : []).forEach(addName);
    return [...names];
}

function collectExplicitPathHints(game = {}) {
    const hints = [];
    const addPath = (value) => {
        if (!value) return;
        const clean = String(value).replace(/"/g, '').trim().toLowerCase();
        if (clean.length > 5) hints.push(clean);
    };
    addPath(game.executablePath);
    (Array.isArray(game.executablePaths) ? game.executablePaths : []).forEach(addPath);
    return hints;
}

// ============================================================
// DYNAMIC NAME GENERATOR (للألعاب اللي ملهاش مسار واضح)
// ============================================================
function generateDynamicAliases(gameName) {
    if (!gameName) return [];
    const clean = gameName.toLowerCase().replace(/[^a-z0-9\s]/g, '');
    const words = clean.split(/\s+/).filter(w => w.length > 0);
    
    const aliases = new Set();
    // مثال: "Rainbow Six Siege" -> "rainbowsixsiege"
    aliases.add(clean.replace(/\s+/g, '')); 
    
    // slug form: "rainbow-six-siege"
    const slug = clean.replace(/\s+/g, '-').replace(/-{2,}/g, '-');
    if (slug) aliases.add(slug);

    if (words.length > 1) {
        // مثال: "Rainbow Six Siege" -> "rss"
        aliases.add(words.map(w => w[0]).join('')); 
        // مثال: "Assassins Creed Valhalla" -> "acvalhalla"
        if (words[0] === 'assassins' && words[1] === 'creed') {
            aliases.add('ac' + words.slice(2).join('')); 
            aliases.add('ac ' + words.slice(2).join(' '));
            aliases.add('ac-' + words.slice(2).join('-'));
        }
    }
    return [...aliases].filter(a => a && a.length >= 3);
}

const osHelper = require('./playtimeOsHelper');

// ── Tracking constants ────────────────────────────────────────────────────────
const TRACK_INTERVAL_MS      = 10_000;
const LAUNCH_TIMEOUT_MS      = 5 * 60_000;   // give up after 5 min if process never appears
const GRACE_PERIOD_MS        = 90_000;        // alt-tab grace before entering paused_bg
const IDLE_THRESHOLD_MS      = 5 * 60_000;   // 5 min idle → paused_idle
const SUSPICIOUS_MIN_RAW_MS  = 60 * 60_000;  // 1 h raw runtime before suspicious check
const SUSPICIOUS_MAX_RATIO   = 0.05;         // <5 % active → suspicious
const QUALIFIED_MIN_MINUTES  = 2;            // min counted min for a session to qualify

const PLATFORM_CLIENTS = new Set([
    'steam', 'steamwebhelper', 'epicgameslauncher', 'epicwebhelper',
    'riotclientservices', 'eadesktop', 'ubisoftconnect', 'upc', 'battlenet',
]);
function _getRiotProductForGame(game = {}, command = '', gameName = '', gameId = '') {
    const text = [
        game.riotProduct,
        game.launcherGameId,
        game?.allIds?.riot,
        command,
        gameName,
        gameId,
        game.id
    ].filter(Boolean).join(' ').toLowerCase();

    const productMatch = String(command || '').toLowerCase().match(/--launch-product=([a-z_]+)/i);
    if (productMatch?.[1]) return productMatch[1].toLowerCase();

    if (text.includes('valorant')) return 'valorant';
    if (text.includes('league_of_legends') || text.includes('league of legends') || text.includes('league')) {
        return 'league_of_legends';
    }

    return null;
}

function _riotExeMatchesProduct(exeName, product) {
    const exe = String(exeName || '').toLowerCase().replace(/\.exe$/i, '') + '.exe';
    const p = String(product || '').toLowerCase();

    if (p === 'valorant') {
        return [
            'valorant-win64-shipping.exe',
            'valorant.exe'
        ].includes(exe);
    }

    if (p === 'league_of_legends' || p.includes('league')) {
        return [
            'leagueclient.exe',
            'leagueclientux.exe',
            'league of legends.exe'
        ].includes(exe);
    }

    return false;
}
const _launchInFlight = new Set();
const activeTrackers = {};
const {
    _cleanGameMatchText,
    _isTechnicalExeSuffix,
    _isVersionLikeSuffix,
    _safeFuzzyGameNameMatch,
} = require('./services/playtimeShared');

async function isGameRunning(command, gamePath, gameName, gameId, isDebugTick = false) {
    try {
        const { default: psList } = await import('ps-list');
        const processes = await psList(); 
        
        const cmdLower = (command || '').toLowerCase();
        const pathLower = (gamePath || '').toLowerCase().replace(/"/g, '').trim();
        const nameLower = (gameName || '').toLowerCase();
        const cleanGameName = nameLower.replace(/[^a-z0-9]/g, '');
        const trackingGame = getTrackingGame(gameId) || {};
        const explicitExes = collectExplicitExeCandidates(trackingGame);
        const explicitPathHints = collectExplicitPathHints(trackingGame);
        const isRiotGame = (trackingGame.scannerPlatform === 'riot') ||
            (String(trackingGame.platform || '').toLowerCase().includes('riot')) ||
            cmdLower.includes('riotclientservices.exe');

        const ignoredExes = ['explorer.exe', 'steam.exe', 'epicgameslauncher.exe', 'riotclientservices.exe', 'eadesktop.exe', 'upc.exe', 'cmd.exe', 'game.exe', 'launcher.exe', 'client.exe', 'host.exe'];

        // جلب الـ Exes ديناميكياً
        const gameExes = await getDynamicGameExes(gameId, pathLower);

        for (const p of processes) {
            const pName = p.name.toLowerCase();
            const pCmd = (p.cmd || '').toLowerCase();
            const cleanProcessName = pName.replace('.exe', '').replace(/[^a-z0-9]/g, '');

            if (explicitExes.includes(pName)) return true;
            if (explicitPathHints.some(hint => pCmd.includes(hint))) return true;

            if (ignoredExes.includes(pName)) continue;

            // 1. التطابق الديناميكي من الفولدر
            if (gameExes.includes(pName)) return true;

            // 2. Riot Games — Win10 compatible detection
            // On Win10 ps-list may not expose --launch-product in cmd; we match
            // by the well-known game EXEs directly as a reliable fallback.
            const riotProduct = _getRiotProductForGame(trackingGame, cmdLower, gameName, gameId);
            if (isRiotGame && riotProduct && _riotExeMatchesProduct(pName, riotProduct)) {
                return true;
            }
            if (cmdLower.includes('riotclientservices.exe')) {
                const productMatch = cmdLower.match(/--launch-product=([a-z_]+)/i);
                if (productMatch?.[1]) {
                    const product = productMatch[1].toLowerCase();
                    const targetExe = product === 'valorant' ? 'valorant-win64-shipping.exe' :
                                      product.includes('league') ? 'leagueclient.exe' :
                                      product + '.exe';
                    if (pName === targetExe) return true;
                }
            }

            // 3. التطابق بالمسار
            if (pathLower && pathLower.length > 5 && pCmd.includes(pathLower)) return true;

            // 4. التطابق بالاسم أو الاختصارات الديناميكية
            if (cleanGameName && cleanProcessName.length >= 3) {
                if (_safeFuzzyGameNameMatch(gameName, pName)) {
                    return true;
                }
                const dynamicAliases = generateDynamicAliases(gameName);
                if (dynamicAliases.includes(cleanProcessName)) return true;
            }
        }

        return false;
    } catch (err) {
        console.error('Process check error:', err);
        return false;
    }
}


function _normalizeUwpText(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[™®©]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function _compactUwpText(value) {
    return _normalizeUwpText(value).replace(/\s+/g, '');
}

function _uwpTitleMatchesGame(title, gameName) {
    const titleNorm = _normalizeUwpText(title);
    const gameNorm = _normalizeUwpText(gameName);
    const titleCompact = _compactUwpText(title);
    const gameCompact = _compactUwpText(gameName);

    if (!titleNorm || !gameNorm) return false;

    if (titleCompact.includes(gameCompact) || gameCompact.includes(titleCompact)) {
        return true;
    }

    const ignored = new Set(['microsoft', 'xbox', 'game', 'games', 'collection']);
    const gameTokens = gameNorm.split(' ').filter(w => w.length >= 3 && !ignored.has(w));
    const titleTokens = new Set(titleNorm.split(' ').filter(w => w.length >= 3 && !ignored.has(w)));

    if (gameTokens.length === 0) return false;

    const hits = gameTokens.filter(w => titleTokens.has(w)).length;
    return hits >= Math.min(2, gameTokens.length);
}

function _parseLaunchCommand(raw) {
    const s = String(raw || '').trim();
    if (!s || s.includes('://') || /^shell:/i.test(s)) {
        return { exePath: null, parsedArgs: [] };
    }
    // Form 1: "quoted path\to\exe.exe" [args...]
    const quotedMatch = s.match(/^"([^"]+\.exe)"\s*(.*)/i);
    if (quotedMatch) {
        const rest = quotedMatch[2].trim();
        return { exePath: quotedMatch[1].trim(), parsedArgs: rest ? rest.split(/\s+/) : [] };
    }
    // Form 2: unquoted path\to\exe.exe [args...] (exe portion has no spaces)
    const unquotedMatch = s.match(/^(\S+\.exe)\s*(.*)/i);
    if (unquotedMatch) {
        const rest = unquotedMatch[2].trim();
        return { exePath: unquotedMatch[1].trim(), parsedArgs: rest ? rest.split(/\s+/) : [] };
    }
    return { exePath: null, parsedArgs: [] };
}

function _extractAppsFolderLaunchTarget(command, trusted = null) {
    const candidates = [
        trusted?.appUserModelId ? `shell:AppsFolder\\${trusted.appUserModelId}` : null,
        trusted?.aumid          ? `shell:AppsFolder\\${trusted.aumid}`          : null,
        trusted?.launchUri      || null,
        command                 || '',
        trusted?.command        || '',
        trusted?.launchCommand  || '',
    ].filter(Boolean);

    for (const raw of candidates) {
        let s = String(raw || '').trim().replace(/^"+|"+$/g, '');

        // Old DB format: explorer.exe shell:AppsFolder\PackageFamilyName!App
        const oldMatch = s.match(/^(?:"?explorer(?:\.exe)?"?\s+)?(shell:AppsFolder\\.+)$/i);
        if (oldMatch) return oldMatch[1].trim();

        // New preferred format: shell:AppsFolder\PackageFamilyName!App
        if (/^shell:AppsFolder\\.+/i.test(s)) return s;

        // Raw AUMID: PackageFamilyName!App
        if (/^[A-Za-z0-9_.-]+_[A-Za-z0-9]+!/.test(s)) return `shell:AppsFolder\\${s}`;
    }

    // If only PackageFamilyName exists, append !App
    const pfn = trusted?.packageFamilyName || trusted?.launcherGameId;
    if (pfn && /^[A-Za-z0-9_.-]+_[A-Za-z0-9]+$/.test(String(pfn))) {
        return `shell:AppsFolder\\${pfn}!App`;
    }

    return null;
}

function _launchAppsFolderTarget(target) {
    return new Promise((resolve) => {
        if (!target || !/^shell:AppsFolder\\/i.test(target)) {
            return resolve({ ok: false, error: new Error('Invalid AppsFolder target') });
        }

        console.log('[Launch][Xbox] explorer.exe', target);

        const child = spawn('explorer.exe', [target], {
            shell:       false,
            windowsHide: false,
            detached:    true,
            stdio:       'ignore',
        });

        let settled = false;

        child.once('spawn', () => {
            settled = true;
            try { child.unref?.(); } catch {}
            resolve({ ok: true, pid: child.pid });
        });

        child.once('error', (err) => {
            if (settled) return;
            settled = true;
            resolve({ ok: false, error: err });
        });

        setTimeout(() => {
            if (settled) return;
            settled = true;
            resolve({ ok: true, pid: child.pid, assumed: true });
        }, 1200);
    });
}

function _isXboxOrStoreGame(game, gameId, command, gamePath) {
    const text = [
        gameId,
        game?.id,
        game?.platform,
        game?.scannerPlatform,
        game?.installSource,
        game?.packageFamilyName,
        command,
        gamePath
    ].filter(Boolean).join(' ').toLowerCase();

    return (
        String(gameId || '').toLowerCase().startsWith('xbox-') ||
        text.includes('xbox') ||
        text.includes('microsoft store') ||
        text.includes('windowsapps')
    );
}

// ── Foreground helper ─────────────────────────────────────────────────────────
// Returns true  = game process is foreground
//         false = something else is foreground
//         null  = OS helper unavailable (treat as active / unknown)
function _isForegroundGame(fgProc, command, gamePath, gameName, gameId) {
    if (!fgProc || !fgProc.name) return null;

    const trackingGame    = getTrackingGame(gameId) || {};
    const explicitExes    = collectExplicitExeCandidates(trackingGame);
    const explicitPaths   = collectExplicitPathHints(trackingGame);
    const fgName          = fgProc.name.toLowerCase().replace(/\.exe$/, '');
    const fgNameExe       = fgName + '.exe';
    const fgExe           = (fgProc.executable || '').toLowerCase().replace(/\\/g, '/');
    const fgTitle         = String(fgProc.title || '').trim();
    const cmdLower        = (command || '').toLowerCase();
    const pathLower       = (gamePath || '').toLowerCase().replace(/"/g, '').trim().replace(/\\/g, '/');

    // Platform client processes are never the game
    if (PLATFORM_CLIENTS.has(fgName)) return false;
    // Microsoft Store / Xbox UWP games often appear as ApplicationFrameHost.exe.
    // Match them by foreground window title instead of process exe.
    if (
        (fgName === 'applicationframehost' || fgNameExe === 'applicationframehost.exe') &&
        _isXboxOrStoreGame(trackingGame, gameId, command, gamePath)
    ) {
        const matched = _uwpTitleMatchesGame(fgTitle, gameName);
        if (matched) {
            console.log(`[Playtime] foreground matched UWP title: ${fgTitle} -> ${gameName}`);
            return true;
        }
    }

    // Explicit exe match (highest confidence)
    if (explicitExes.some(e => e === fgNameExe || e === fgName)) return true;

    // Explicit path match
    if (explicitPaths.some(hint => fgExe.includes(hint.replace(/\\/g, '/')))) return true;
    if (pathLower.length > 5 && fgExe.includes(pathLower)) return true;

    // Riot platform matches
    const isRiotGame = (trackingGame.scannerPlatform === 'riot') ||
        (String(trackingGame.platform || '').toLowerCase().includes('riot')) ||
        cmdLower.includes('riotclientservices.exe');
    const riotProduct = _getRiotProductForGame(trackingGame, cmdLower, gameName, gameId);
    if (isRiotGame && riotProduct && _riotExeMatchesProduct(fgNameExe, riotProduct)) {
        console.log(`[Playtime] foreground matched Riot product: ${riotProduct} ${fgNameExe} -> ${gameName}`);
        return true;
    }

    // Fallback for manual games where executablePath/exeCandidates are missing.
// Example: gameName="ACMirage", foreground process="acmirage.exe".
const cleanFgName = fgName.replace(/[^a-z0-9]/g, '');
const cleanGameName = String(gameName || '').toLowerCase().replace(/[^a-z0-9]/g, '');

if (cleanGameName && cleanFgName.length >= 3) {
    if (_safeFuzzyGameNameMatch(gameName, fgName)) {
        console.log(`[Playtime] foreground matched safe fuzzy name: ${fgName} -> ${gameName}`);
        return true;
    }

    const aliases = generateDynamicAliases(gameName).map(a =>
        String(a || '').toLowerCase().replace(/[^a-z0-9]/g, '')
    );

    if (aliases.includes(cleanFgName)) {
        console.log(`[Playtime] foreground matched alias: ${fgName} -> ${gameName}`);
        return true;
    }
}

    return false;
}

// ── State machine tick ────────────────────────────────────────────────────────
async function _tickTracker(gameId, command, gamePath, gameName) {
    const tracker = activeTrackers[gameId];
    if (!tracker) return;

    tracker.checkCount++;
    const isDebugTick = tracker.checkCount <= 4 && tracker.state === 'launching';
    const isRunning   = await isGameRunning(command, gamePath, gameName, gameId, isDebugTick);
    const now         = Date.now();

    // ── Process gone → end ────────────────────────────────────────────────────
    if (!isRunning) {
        if (tracker.state === 'launching' && now - tracker.clickTime < LAUNCH_TIMEOUT_MS) return;
        _endTrackerSession(gameId, tracker, gameName, 'process_gone');
        return;
    }

    // ── First process detection ───────────────────────────────────────────────
    if (!tracker.sessionStartTime) {
        tracker.sessionStartTime = now;
        tracker.state = 'detected';
        console.log(`[Playtime] session detected: ${gameName}`);
    }
    tracker.totalRawMs = now - tracker.sessionStartTime;

    // ── Foreground + idle checks ──────────────────────────────────────────────
    const [fgProc, idleMs] = await Promise.all([
        osHelper.getForegroundProcess(),
        osHelper.getIdleMs(),
    ]);

    const osAvailable = fgProc !== null;
    const isFg        = osAvailable ? _isForegroundGame(fgProc, command, gamePath, gameName, gameId) : null;

    if (osAvailable && fgProc && (tracker.checkCount <= 4 || String(fgProc.name || '').toLowerCase().includes('applicationframehost'))) {
        console.log(`[Playtime] fg check: game=${gameName} fgName=${fgProc.name} fgTitle=${fgProc.title || ''} isFg=${isFg}`);
    }
    const isIdle      = osAvailable ? idleMs >= IDLE_THRESHOLD_MS : false;

    // ── OS helper unavailable: split policy by session origin ─────────────────
    // User-explicitly-launched sessions get legacy counting (effectiveFg=true,
    // confidence upgraded to 'legacy'). External/watcher sessions stay in
    // 'detected' state — they must not qualify without actual FG confirmation.
    let effectiveFg;
    if (!osAvailable) {
        if (tracker.userLaunched) {
            effectiveFg = true;
            if (!tracker._osHelperWarnedOnce) {
                console.log(`[Playtime] OS helper unavailable — legacy counting for user-launched: ${gameName}`);
                tracker._osHelperWarnedOnce = true;
                tracker.confidence = 'legacy';
            }
        } else {
            effectiveFg = false;
            if (!tracker._osHelperWarnedOnce) {
                console.log(`[Playtime] OS helper unavailable — external session stays unconfirmed (won't qualify): ${gameName}`);
                tracker._osHelperWarnedOnce = true;
            }
        }
    } else {
        // OS helper available: only match if explicitly confirmed as game foreground
        effectiveFg = isFg === true;
    }

    // ── State transitions ─────────────────────────────────────────────────────
    if (tracker.state === 'detected' || tracker.state === 'paused_bg' || tracker.state === 'paused_idle') {
        if (effectiveFg && !isIdle) {
            // Transition to ACTIVE
            tracker.state         = 'active';
            tracker.activeStartTime = now;
            tracker.foregroundSeen  = true;
            if (tracker.state !== 'detected') {
                console.log(`[Playtime] resumed: ${gameName}`);
            }
            console.log(`[Playtime] foreground active: ${gameName}`);
        } else if (isIdle && tracker.state !== 'paused_idle') {
            tracker.state         = 'paused_idle';
            tracker.idleStartTime = now;
            console.log(`[Playtime] paused idle: ${gameName}`);
        }

    } else if (tracker.state === 'active') {
        if (isIdle) {
            _flushActiveTime(tracker, now);
            tracker.state         = 'paused_idle';
            tracker.idleStartTime = now;
            console.log(`[Playtime] paused idle: ${gameName}`);
        } else if (!effectiveFg) {
            _flushActiveTime(tracker, now);
            tracker.state       = 'paused_bg';
            tracker.graceEndTime = now + GRACE_PERIOD_MS;
            tracker.bgStartTime  = now;
            console.log(`[Playtime] paused background: ${gameName}`);
        } else {
            // Still active — accumulate
            tracker.foregroundSeen = true;
            _doPeriodicSave(gameId, tracker);
        }
    }

    // ── Grace period accounting for paused_bg ────────────────────────────────
    if (tracker.state === 'paused_bg') {
        if (effectiveFg && !isIdle) {
            // Came back — resume active
            tracker.state        = 'active';
            tracker.activeStartTime = now;
            tracker.foregroundSeen  = true;
            console.log(`[Playtime] foreground active: ${gameName}`);
            if (tracker.bgStartTime) {
                tracker.backgroundMs += now - tracker.bgStartTime;
                tracker.bgStartTime   = null;
            }
        } else if (now > tracker.graceEndTime && tracker.bgStartTime) {
            // Grace expired — account background time and reset
            tracker.backgroundMs += now - tracker.bgStartTime;
            tracker.bgStartTime   = now;
        }
    }

    // ── Idle time accounting ──────────────────────────────────────────────────
    if (tracker.state === 'paused_idle' && tracker.idleStartTime) {
        if (!isIdle) {
            tracker.idleMs += now - tracker.idleStartTime;
            tracker.idleStartTime = null;
            if (effectiveFg) {
                tracker.state         = 'active';
                tracker.activeStartTime = now;
                tracker.foregroundSeen  = true;
                console.log(`[Playtime] resumed: ${gameName}`);
            } else {
                tracker.state       = 'paused_bg';
                tracker.graceEndTime = now + GRACE_PERIOD_MS;
                tracker.bgStartTime  = now;
            }
        }
    }

    // ── Suspicious detection ──────────────────────────────────────────────────
    if (tracker.state !== 'suspicious' && tracker.totalRawMs >= SUSPICIOUS_MIN_RAW_MS) {
        const activeMs = tracker.totalActiveMs + (
            tracker.state === 'active' && tracker.activeStartTime ? now - tracker.activeStartTime : 0
        );
        if (activeMs / tracker.totalRawMs < SUSPICIOUS_MAX_RATIO) {
            tracker.state = 'suspicious';
            console.log(`[Playtime] suspicious background-like session: ${gameName}`);
        }
    }
}

function _flushActiveTime(tracker, now) {
    if (tracker.state === 'active' && tracker.activeStartTime) {
        tracker.totalActiveMs += now - tracker.activeStartTime;
        tracker.activeStartTime = null;
    }
}

function _doPeriodicSave(gameId, tracker) {
    const savedMs = tracker.lastSavedActiveMs || 0;
    const delta   = tracker.totalActiveMs - savedMs;
    if (delta < 5 * 60_000) return;
    const mins = Math.floor(delta / 60_000);
    const gameScanner = require('./gameScanner');
    gameScanner.updatePlaytime(gameId, mins).catch((err) => {
        console.error('[Playtime] periodic updatePlaytime error:', err);
    });
    tracker.lastSavedActiveMs = savedMs + mins * 60_000;
}

function _endTrackerSession(gameId, tracker, gameName, reason) {
    clearInterval(tracker.intervalId);
    tracker.endReason = reason;

    const now = Date.now();
    _flushActiveTime(tracker, now);

    // Account any open bg/idle windows
    if (tracker.bgStartTime) {
        tracker.backgroundMs += now - tracker.bgStartTime;
    }
    if (tracker.idleStartTime) {
        tracker.idleMs += now - tracker.idleStartTime;
    }

    if (tracker.sessionStartTime) {
        saveTrackerPlaytime(gameId, tracker, gameName);
    }
    delete activeTrackers[gameId];
}

function startGameTracking(gameId, command, gamePath, gameName, confidence = 'high', userLaunched = false) {
    if (activeTrackers[gameId]) return;

    const game = getTrackingGame(gameId);
    if (game && game.timeTrackingEnabled === false) {
        console.log(`[Playtime] tracking disabled for game: ${gameName}`);
        return;
    }

    activeTrackers[gameId] = {
        state:                'launching',
        confidence,
        userLaunched,
        clickTime:            Date.now(),
        sessionStartTime:     null,
        activeStartTime:      null,
        totalActiveMs:        0,
        totalRawMs:           0,
        idleMs:               0,
        backgroundMs:         0,
        foregroundSeen:       false,
        graceEndTime:         null,
        bgStartTime:          null,
        idleStartTime:        null,
        lastSavedActiveMs:    0,
        checkCount:           0,
        endReason:            '',
        _osHelperWarnedOnce:  false,
        platform:             _detectPlatform(command),
        gameName,
        intervalId:           null,
    };

    activeTrackers[gameId].intervalId = setInterval(
        () => _tickTracker(gameId, command, gamePath, gameName),
        TRACK_INTERVAL_MS,
    );
}

function startGlobalWatcher() {
    setInterval(async () => {
        try {
            const { default: psList } = await import('ps-list');
            const processes = await psList();
            const games     = getSavedGames();

            for (const game of games) {
                if (activeTrackers[game.id]) continue;
                if (game.timeTrackingEnabled === false) continue;

                const command  = (game.command || '').toLowerCase();
                const gamePath = (game.path || '').toLowerCase().replace(/"/g, '').trim();
                const gameName = (game.name || '').toLowerCase();
                const cleanGameName = gameName.replace(/[^a-z0-9]/g, '');
                const explicitExes  = collectExplicitExeCandidates(game);
                const explicitPaths = collectExplicitPathHints(game);
                const isRiotGame    = (game.scannerPlatform === 'riot') ||
                    (String(game.platform || '').toLowerCase().includes('riot')) ||
                    command.includes('riotclientservices.exe');

                const IGNORED = new Set([
                    'explorer.exe', 'steam.exe', 'epicgameslauncher.exe',
                    'riotclientservices.exe', 'eadesktop.exe', 'upc.exe',
                    'ubisoftconnect.exe', 'cmd.exe', 'powershell.exe',
                    'game.exe', 'launcher.exe', 'client.exe', 'host.exe',
                ]);

                const gameExes = await getDynamicGameExes(game.id, gamePath);

                let matchedConf = null;

                for (const p of processes) {
                    const pName = p.name.toLowerCase();
                    const pCmd  = (p.cmd || '').toLowerCase();

                    if (IGNORED.has(pName)) continue;

                    // High confidence: explicit exe / path
                    if (explicitExes.includes(pName) ||
                        explicitPaths.some(h => pCmd.includes(h))) {
                        matchedConf = 'high'; break;
                    }

                    // Medium confidence: dynamic game exes or Riot game exes
                    if (gameExes.includes(pName)) { matchedConf = 'medium'; break; }

                    const riotProduct = _getRiotProductForGame(game, command, game.name, game.id);

                    if (isRiotGame && riotProduct && _riotExeMatchesProduct(pName, riotProduct)) {
                        matchedConf = 'medium';
                        break;
                    }

                    if (command.includes('riotclientservices.exe')) {
                        const pm = command.match(/--launch-product=([a-z_]+)/i);
                        if (pm?.[1]) {
                            const prod = pm[1].toLowerCase();
                            const tgt  = prod === 'valorant' ? 'valorant-win64-shipping.exe' :
                                         prod.includes('league') ? 'leagueclient.exe' :
                                         prod + '.exe';
                            if (pName === tgt) { matchedConf = 'medium'; break; }
                        }
                    }

                    // Medium confidence: path substring
                    if (gamePath.length > 5 && pCmd.includes(gamePath)) { matchedConf = 'medium'; break; }

                    // Low confidence: safe name fuzzy match
                    if (_safeFuzzyGameNameMatch(gameName, pName)) {
                        matchedConf = 'low';
                        break;
                    }

                    const cleanProc = pName.replace('.exe', '').replace(/[^a-z0-9]/g, '');
                    const aliases = generateDynamicAliases(gameName);
                    if (aliases.includes(cleanProc)) {
                        matchedConf = 'low';
                        break;
                    }
                }

                if (matchedConf) {
                    console.log(`[Playtime] external launch detected: ${game.name} (confidence=${matchedConf}) — OS helper required for session to qualify`);
                    startGameTracking(game.id, game.command, game.path, game.name, matchedConf);
                }
            }
        } catch (_err) {}
    }, 15_000);
}

function saveTrackerPlaytime(gameId, tracker, gameName) {
    if (!tracker.sessionStartTime) return;

    const now               = Date.now();
    const totalActiveMs     = tracker.totalActiveMs;
    const totalCountedMin   = Math.round(totalActiveMs / 60_000);
    const savedMs           = tracker.lastSavedActiveMs || 0;
    const unsavedMin        = Math.max(0, Math.round((totalActiveMs - savedMs) / 60_000));
    const rawMin            = Math.round((tracker.totalRawMs || 0) / 60_000);
    const idleMin           = Math.round((tracker.idleMs || 0) / 60_000);
    const bgMin             = Math.round((tracker.backgroundMs || 0) / 60_000);

    // Legacy sessions: user explicitly launched, OS helper was unavailable.
    // We tracked as active throughout so treat foregroundSeen as confirmed.
    const foregroundSeen = tracker.foregroundSeen || tracker.confidence === 'legacy';

    const isQualified =
        totalCountedMin >= QUALIFIED_MIN_MINUTES &&
        foregroundSeen &&
        tracker.state !== 'suspicious' &&
        tracker.confidence !== 'suspicious';

    if (isQualified) {
        console.log(`[Playtime] session qualified: ${gameName} (${totalCountedMin} min active, confidence=${tracker.confidence})`);
    } else {
        console.log(`[Playtime] session not qualified: ${gameName} (${totalCountedMin} min active, fg=${foregroundSeen}, state=${tracker.state}, confidence=${tracker.confidence})`);
    }

    const sessionData = {
        countedMinutes:      unsavedMin,
        totalCountedMinutes: totalCountedMin,
        rawRuntimeMinutes:   rawMin,
        idleMinutes:         idleMin,
        backgroundMinutes:   bgMin,
        foregroundSeen,
        confidence:          tracker.confidence || 'medium',
        endReason:           tracker.endReason || 'process_gone',
        startedAt:           tracker.sessionStartTime,
        endedAt:             now,
        isQualified,
    };

    const gameScanner = require('./gameScanner');

    // Guard: ensure the export is wired up correctly (catches future regressions early)
    if (typeof gameScanner.saveQualifiedSession !== 'function') {
        console.error('[Playtime] saveQualifiedSession is not a function on gameScanner — skipping save for:', gameName);
        return;
    }

    console.log(`[Playtime] saveTrackerPlaytime → gameId=${gameId} gameName=${gameName}`);
    console.log(`[Playtime] sessionData:`, JSON.stringify(sessionData));

    gameScanner.saveQualifiedSession(gameId, sessionData).then(result => {
        console.log(`[Playtime] saveQualifiedSession result: status=${result.status} totalPlaytime=${result.totalPlaytime} sessionQualified=${result.sessionQualified}`);
        if (mainWindow && result.status === 'success') {
            mainWindow.webContents.send('playtime-updated', {
                gameId,
                totalMinutes:        result.totalPlaytime,
                lastPlayed:          result.lastPlayed,
                lastQualifiedPlayed: result.lastQualifiedPlayed,
                playSessions:        result.playSessions,
                sessionQualified:    result.sessionQualified,
            });
        }
        analytics.logSessionEnded(tracker.platform || 'unknown', totalCountedMin).catch(() => {});
    }).catch(err => {
        console.error('[Playtime] saveQualifiedSession error:', err);
    });
}
// ============================================================
// DRIVE CACHE
// ============================================================
async function refreshDriveCache() {
    try {
        const cmd = `powershell "[System.IO.DriveInfo]::GetDrives() | Where-Object {$_.DriveType -eq 'Fixed'} | Select-Object @{n='DriveLetter';e={$_.Name}}, @{n='FileSystemLabel';e={$_.VolumeLabel}} | ConvertTo-Json"`;
        const { stdout } = await execAsync(cmd);
        if (!stdout.trim()) return;
        let volumes = JSON.parse(stdout);
        if (!Array.isArray(volumes)) volumes = [volumes];
        driveCache.data = volumes.map(v => ({
            path: v.DriveLetter,
            label: v.FileSystemLabel?.trim() || 'Local Disk'
        }));
        driveCache.lastFetched = Date.now();
    } catch (err) {
        console.error('[Drive Cache] Refresh failed:', err);
    }
}

// ============================================================
// TRAY
// ============================================================
function createTray() {
    tray = new Tray(path.join(__dirname, 'Logo.ico'));
    tray.setToolTip('Baddel Launcher');
    tray.setContextMenu(Menu.buildFromTemplate([
        { label: 'Open Baddel Launcher', click: () => mainWindow.show() },
        { label: 'Quick Switch', click: () => quickSwitcher.toggleQuickSwitcherOverlay().catch(() => {}) },
        { type: 'separator' },
        { label: 'Exit', click: () => { isQuitting = true; app.quit(); } }
    ]));
    tray.on('click', () => {
        mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
    });
}

// ============================================================
// WINDOW
// ============================================================
// ============================================================
// WINDOW
// ============================================================
// ============================================================
// WINDOW
// ============================================================
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280, height: 800,
        minWidth: 1000, minHeight: 600,
        backgroundColor: '#0c0c0c',
        show: false,
        frame: false,
        titleBarStyle: 'hidden',
        icon: path.join(__dirname, 'Logo.ico'),
        backgroundThrottling: false,
        webPreferences: {
            preload:                    path.join(__dirname, 'preload.js'),
            contextIsolation:           true,
            nodeIntegration:            false,
            webSecurity:                true,   // re-enabled; CDN scripts removed (see dashboard.html)
            webviewTag:                 true,   // renderer uses <webview> for YouTube trailers
            allowRunningInsecureContent: false,
            // sandbox: true is intentionally omitted — our preload uses webUtils/shell from
            // require('electron') which are not available in fully sandboxed preloads
            // on Electron 28.  Revisit after full upgrade to Electron 34+.
        }
    });

    mainWindow.on('close', (event) => {
        if (!isQuitting) { event.preventDefault(); mainWindow.hide(); }
    });

    // ── Security hardening ──────────────────────────────────────────────────
    // Deny all permission requests from the renderer (camera, mic, geolocation…)
    mainWindow.webContents.session.setPermissionRequestHandler((_wc, _perm, callback) => {
        callback(false);
    });

    // Deny all window.open / target="_blank" attempts
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        console.warn('[Security] Blocked window.open to:', url);
        return { action: 'deny' };
    });

    // Prevent renderer from navigating away from the local app file
    mainWindow.webContents.on('will-navigate', (event, url) => {
        if (!url.startsWith('file://')) {
            event.preventDefault();
            console.warn('[Security] Blocked renderer navigation to:', url);
        }
    });
    // ────────────────────────────────────────────────────────────────────────

    // ── Webview security: only allow YouTube embed URLs ─────────────────────
    // Matches youtube.com/embed/ID and youtube-nocookie.com/embed/ID
    const _YT_EMBED_RE = /^https:\/\/www\.(youtube(?:-nocookie)?\.com)\/embed\/[a-zA-Z0-9_-]{11}(\?|$)/;
    const _YT_ALLOWED  = /^https:\/\/(www\.)?(youtube(-nocookie)?\.com|youtu\.be|ytimg\.com|googlevideo\.com|gstatic\.com|google\.com)\//;

    mainWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
        // Strip any injected preload scripts
        delete webPreferences.preload;
        delete webPreferences.preloadURL;

        // Force locked-down permissions — watch URLs and arbitrary pages are not allowed
        webPreferences.nodeIntegration            = false;
        webPreferences.contextIsolation           = true;
        webPreferences.sandbox                    = true;
        webPreferences.webSecurity                = true;
        webPreferences.allowRunningInsecureContent = false;

        // Force isolated session partition
        params.partition = 'persist:baddel-youtube-trailers';

        // Only allow youtube.com/embed/ID or youtube-nocookie.com/embed/ID
        const src = params.src || '';
        if (!_YT_EMBED_RE.test(src)) {
            console.warn('[Security] Blocked webview attach for non-embed src:', src);
            event.preventDefault();
        }
    });
    // ────────────────────────────────────────────────────────────────────────

    mainWindow.maximize();
    mainWindow.loadFile(path.join(__dirname, 'src', 'dashboard.html'));
    mainWindow.once('ready-to-show', () => {
        if (isStartupLaunch) {
            // Boot-time launch: stay hidden in tray, do not steal focus.
            console.log('[Startup] launched hidden to tray');
        } else {
            mainWindow.show();
        }

        // Auto-updater check — delayed at boot to avoid hitting the network
        // before Windows has fully initialised the network stack.
        runAfterStartupGrace('checkForUpdates', () => {
            if (autoUpdater) {
                autoUpdater.checkForUpdates().catch(err => console.warn('[AutoUpdater] Startup check failed:', err.message));
                setInterval(() => autoUpdater && autoUpdater.checkForUpdates().catch(err => console.warn('[AutoUpdater] Periodic check failed:', err.message)), 14400000);
            }
        }, 60000);

        // Background library sync — fires 12 s after window shows (or after the
        // startup grace period) so the first render cycle settles first.
        if (process.env.BADDEL_DISABLE_STARTUP_SYNC !== '1') {
            runAfterStartupGrace('autoSyncOnStartup', () => autoSyncOnStartup(), 45000);
        } else {
            console.log('[DEV] Startup platform auto-sync disabled via BADDEL_DISABLE_STARTUP_SYNC=1');
        }
    });
}

// ── Webview security: navigation + popup hardening for all new webContents ─
// Runs for every WebContents including <webview> instances in the renderer.
app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() !== 'webview') return;

    const _YT_NAV_ALLOWED = /^https:\/\/(www\.)?(youtube(-nocookie)?\.com|youtu\.be|ytimg\.com|googlevideo\.com|gstatic\.com|google\.com)\//;

    // Block all popup/window.open attempts from the webview
    contents.setWindowOpenHandler(({ url }) => {
        console.warn('[Security/webview] Blocked window.open to:', url);
        return { action: 'deny' };
    });

    // Allow navigations only to YouTube-family domains
    contents.on('will-navigate', (event, url) => {
        if (!_YT_NAV_ALLOWED.test(url)) {
            event.preventDefault();
            console.warn('[Security/webview] Blocked navigation to:', url);
        }
    });
});

ipcMain.on('minimize-app', () => mainWindow?.minimize());
ipcMain.on('maximize-app', () => {
    if (!mainWindow) return;
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});
ipcMain.on('close-app', () => mainWindow?.close());

// ============================================================
// IMAGE CACHE
// ============================================================
let CACHE_DIR;

// Semaphore to limit concurrent downloads to 3
let _activeDownloads = 0;
const _downloadQueue = [];

function runDownloadQueue() {
    while (_activeDownloads < 3 && _downloadQueue.length > 0) {
        const { url, filename, resolve, reject } = _downloadQueue.shift();
        _activeDownloads++;
        _doDownload(url, filename)
            .then(resolve)
            .catch(reject)
            .finally(() => { _activeDownloads--; runDownloadQueue(); });
    }
}

async function _doDownload(url, filename) {
    const filePath = path.join(CACHE_DIR, filename);
    const tmpPath = filePath + '.tmp'; // إنشاء مسار لملف مؤقت

    // Return cached file immediately if it exists and has content
    try {
        const stats = await fs.stat(filePath);
        if (stats.size > 0) return filePath;
    } catch { /* not found, download it */ }

    // Use https/http module — reliable in Electron main process, handles redirects
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? require('https') : require('http');
        const fileStream = require('fs').createWriteStream(tmpPath); // الكتابة في الملف المؤقت أولاً
        const cleanup = () => { try { require('fs').unlinkSync(tmpPath); } catch {} };

        const request = protocol.get(url, {
            headers: { 'User-Agent': 'BaddelLauncher/1.0' },
            timeout: 15000
        }, (res) => {
            // Follow redirects
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                fileStream.close();
                cleanup();
                _doDownload(res.headers.location, filename).then(resolve).catch(reject);
                return;
            }
            if (res.statusCode !== 200) {
                fileStream.close(); cleanup();
                reject(new Error(`HTTP ${res.statusCode}`));
                return;
            }
            res.pipe(fileStream);
            fileStream.on('finish', () => { 
                fileStream.close(() => {
                    // بعد إغلاق الملف بالكامل، نقوم بتغيير اسمه للمسار النهائي
                    try {
                        require('fs').renameSync(tmpPath, filePath);
                        resolve(filePath);
                    } catch (e) {
                        reject(e);
                    }
                }); 
            });
            fileStream.on('error', (e) => { cleanup(); reject(e); });
        });

        request.on('error', (e) => { fileStream.close(); cleanup(); reject(e); });
        request.on('timeout', () => {
            request.destroy();
            fileStream.close(); cleanup();
            reject(new Error('Timeout: ' + filename));
        });
    });
}

function downloadImage(url, filename) {
    return new Promise((resolve, reject) => {
        _downloadQueue.push({ url, filename, resolve, reject });
        runDownloadQueue();
    });
}

// ============================================================
// APP STARTUP
// ============================================================
app.setAppUserModelId('com.baddel.launcher.beta');

// ✅ لازم يتسجل قبل app.whenReady — بيعرّف الـ custom scheme اللي Steam بيعمل redirect ليه بعد login
protocol.registerSchemesAsPrivileged([
    { scheme: 'baddelsteam', privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);

app.whenReady().then(async () => {
    // ── Startup diagnostics — logged before anything else can throw ──────────
    try {
        const fsSync = require('fs');
        const appPath = app.getAppPath();
        const asarPath = path.join(app.getPath('exe').replace(/[^/\\]+$/, ''), 'resources', 'app.asar');
        console.log('[Startup] app.isPackaged      :', app.isPackaged);
        console.log('[Startup] app.getVersion()    :', app.getVersion());
        console.log('[Startup] app.getAppPath()    :', appPath);
        console.log('[Startup] process.resourcesPath:', process.resourcesPath);
        console.log('[Startup] process.execPath    :', process.execPath);
        console.log('[Startup] process.defaultApp  :', !!process.defaultApp);
        console.log('[Startup] app.asar exists     :', fsSync.existsSync(asarPath));
        console.log('[Startup] package.json exists :', fsSync.existsSync(path.join(appPath, 'package.json')));
    } catch (diagErr) {
        console.warn('[Startup] Diagnostics error (non-fatal):', diagErr.message);
    }

    // ── Auto-updater (must be after app is ready — electron-updater reads package.json) ──
    setupAutoUpdater();

    // Analytics init — deferred at boot so the network flush doesn't fail during
    // the Windows startup window where network services may not be ready yet.
    // For normal launches, runAfterStartupGrace returns fn() so await still works.
    await runAfterStartupGrace('analytics.init', () => analytics.init(), 30000);
    analytics.writeUninstallTelemetryConfig().catch(() => {});
    analytics.startHeartbeat();

    setupWindowsIntegration();
    runAfterStartupGrace('refreshDriveCache', () => refreshDriveCache(), 20000);
    runAfterStartupGrace('startGlobalWatcher', () => startGlobalWatcher(), 30000);

    CACHE_DIR = path.join(app.getPath('userData'), 'image_cache');
    require('fs').mkdirSync(CACHE_DIR, { recursive: true });

    // ---- Games Library ----
    // ── FIX: guard against concurrent background scans ──────────────────────
    // get-installed-games is called by BOTH app.js (initSystem) and accounts.js
    // (renderAllGamesView) during startup.  Without a guard, each call launches
    // an independent scanAllGames() in the background → two 'library-updated'
    // events arrive at the renderer → EnrichQueue drains twice on the same games
    // → duplicate lookupGameServer calls, 429 rate-limit storms, and skeleton hangs.
    let _backgroundScanInProgress = false;

    ipcMain.handle('get-installed-games', async () => {
        const stored = getSavedGames();

        // Helper: notify renderer when a single game's images are ready
        const notifyGameImageUpdated = (game) => {
            if (mainWindow) mainWindow.webContents.send('game-image-updated', game);
        };

        if (stored.length === 0) {
            // Fresh install / wiped DB — scan first, then refetch missing images
            console.log('[Startup] Fresh install detected — running full scan + background metadata pipeline.');
            const games = await scanAllGames();
            // Fire image refetch in background; renderer gets live updates via 'game-image-updated'
            require('./gameScanner').refetchMissingImages(notifyGameImageUpdated).catch(() => {});
            // ── Run background metadata pipeline for non-Steam/Epic games ──────────
            // Fires after scan so the DB is fully populated before we read it.
            require('./gameScanner').runBackgroundMetadataPipeline(games).catch(err =>
                console.warn('[BackgroundMetaPipeline] Fresh-install pipeline error:', err.message)
            );
            return games;
        }

        // Return stored immediately, sync in background.
        // Only ONE background scan may run at a time — if a scan is already in
        // progress (e.g. from a concurrent initSystem + renderAllGamesView call),
        // skip launching a second one.  The first scan will still fire
        // 'library-updated' when it completes, so no update is lost.
        if (!_backgroundScanInProgress) {
            _backgroundScanInProgress = true;
            scanAllGames()
                .then(updated => {
                    _backgroundScanInProgress = false;
                    if (mainWindow) mainWindow.webContents.send('library-updated', updated);
                    // After scan, re-fetch images for any game still missing a cover
                    require('./gameScanner').refetchMissingImages(notifyGameImageUpdated).catch(() => {});
                    // ── Run background metadata pipeline for non-Steam/Epic games ──
                    // Deferred 2 s so the library-updated render cycle settles first.
                    setTimeout(() => {
                        require('./gameScanner').runBackgroundMetadataPipeline(updated).catch(err =>
                            console.warn('[BackgroundMetaPipeline] Background scan pipeline error:', err.message)
                        );
                    }, 2000);
                })
                .catch(() => { _backgroundScanInProgress = false; });
        }

        return stored;
    });

    ipcMain.handle('add-manual-game', async (_, exePath, customName) => {
        try { ipcValidation.assertPathLike(exePath, 'exePath'); } catch (e) { return ipcValidation.sanitizeErrorForRenderer(e); }
        let lnkTarget    = null;
        let metadataPath = exePath;
        let shortcutArgs = '';
        let shortcutCwd  = null;
        if (exePath.toLowerCase().endsWith('.lnk')) {
            try {
                const details = shell.readShortcutLink(exePath);
                if (details.target) {
                    lnkTarget    = details.target;
                    metadataPath = details.target;
                }
                shortcutArgs = details.args || '';
                shortcutCwd  = details.cwd || details.workingDirectory ||
                    (lnkTarget ? path.dirname(lnkTarget) : null);
            } catch { /* ignore shortcut read errors */ }
        }
        const notifyGameImageUpdated = (game) => {
            if (mainWindow) mainWindow.webContents.send('game-image-updated', game);
        };
        const result = await require('./gameScanner').addManualGame(
            exePath, customName, notifyGameImageUpdated,
            { lnkTarget, metadataPath, shortcutArgs, shortcutCwd, forceMetadata: true }
        );
        if (result.status === 'success') {
            analytics.logGameAddedManual().catch(() => {});
        }
        return result;
    });

    // ── Game Library IPC (moved to handlers/gameLibraryHandlers.js) ──────────
    require('./handlers/gameLibraryHandlers').register(ipcMain, {
        ipcValidation,
        getSavedGames,
        scanAllGames,
        removeGame,
        renameGame,
        unhideAllGames,
        getHiddenGames,
        restoreSpecificGames,
        deleteGamePermanently,
        reorderLibrary,
        getDynamicGameExes,
        _detectPlatform,
        analytics,
        getMainWindow: () => mainWindow,
    });
    // ── Local Metadata IPC (moved to handlers/localMetadataHandlers.js) ─────
    require('./handlers/localMetadataHandlers').register(ipcMain, {
        ipcValidation,
        getSavedGames,
        updateGameMetadata,
        saveFullMetadata,
        loadFullMetadata,
        getMainWindow: () => mainWindow,
    });
    // ── Playtime IPC (moved to handlers/playtimeHandlers.js) ─────────────────
    require('./handlers/playtimeHandlers').register(ipcMain, {
        updatePlaytime,
        setTimeTrackingEnabled,
        getTimeTrackingEnabled,
        activeTrackers,
    });

    // ---- Riot Client manual path selection (legacy, kept for backward compat) ----
    ipcMain.handle('select-riot-client-manually', async () => {
        const result = await dialog.showOpenDialog(mainWindow, {
            title:       'Locate RiotClientServices.exe',
            properties:  ['openFile'],
            filters:     [{ name: 'RiotClientServices.exe', extensions: ['exe'] }],
        });
        if (result.canceled || !result.filePaths.length) return { success: false, canceled: true };
        const selected = result.filePaths[0];
        try {
            const riotPathResolver = require('./services/riotPathResolver');
            const valid = await riotPathResolver.saveManualRiotClientPath(selected);
            return { success: true, path: valid, platform: 'riot' };
        } catch (err) {
            return { success: false, message: err.message, code: err.code };
        }
    });

    // ---- Generic launcher manual path selection (all platforms) ----
    ipcMain.handle('select-launcher-manually', async (_, platform) => {
        const launcherPathResolver = require('./services/launcherPathResolver');
        const info = launcherPathResolver.getPlatformInfo(platform);
        if (!info) return { success: false, code: 'UNSUPPORTED_PLATFORM', message: `Unknown platform: ${platform}` };

        const result = await dialog.showOpenDialog(mainWindow, {
            title:      info.dialogTitle || `Locate ${info.name}`,
            properties: ['openFile'],
            filters:    [{ name: `${info.name} executable`, extensions: ['exe'] }],
        });
        if (result.canceled || !result.filePaths.length) return { success: false, canceled: true };
        const selected = result.filePaths[0];
        try {
            const valid = await launcherPathResolver.saveManualLauncherPath(platform, selected);
            return { success: true, path: valid, platform };
        } catch (err) {
            return { success: false, message: err.message, code: err.code };
        }
    });

    const creatorPackMime = (filename) => {
        const ext = path.extname(String(filename || '')).toLowerCase();
        return ({
            '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
            '.avif': 'image/avif', '.gif': 'image/gif', '.mp4': 'video/mp4', '.webm': 'video/webm',
            '.mov': 'video/quicktime', '.m4v': 'video/mp4', '.ogv': 'video/ogg',
        })[ext] || 'application/octet-stream';
    };
    const creatorSafeName = (name, fallback = 'asset') => {
        const cleaned = String(name || fallback).replace(/[^a-z0-9._-]/gi, '_').slice(0, 80);
        return cleaned || fallback;
    };
    const creatorPathToFileUrl = (p) => {
        const normalized = String(p || '').replace(/\\/g, '/');
        return `file:///${normalized.replace(/^\/+/, '')}`;
    };
    const creatorResolveLocalPath = (url) => {
        if (!url || typeof url !== 'string') return null;
        if (url.startsWith('file://')) return fileURLToPath(url);
        return null;
    };
    const creatorEmbedAssets = async (pack) => {
        const cloned = JSON.parse(JSON.stringify(pack || {}));
        cloned.assets = cloned.assets || {};
        const page = cloned.page || {};
        let assetSeq = Object.keys(cloned.assets).length + 1;
        const missing = [];
        const toAsset = async (value, hint, kind = 'image') => {
            if (!value || typeof value !== 'string') return value;
            if (value.startsWith('asset://') || /^https?:\/\//i.test(value)) return value;
            let bytes = null;
            let filename = `${hint || 'asset'}-${assetSeq}`;
            let mime = 'application/octet-stream';
            if (value.startsWith('data:')) {
                const m = value.match(/^data:([^;,]+);base64,(.+)$/);
                if (!m) return value;
                mime = m[1];
                bytes = Buffer.from(m[2], 'base64');
                filename = `${filename}.${mime.split('/')[1] || 'bin'}`;
            } else if (value.startsWith('file://')) {
                const p = creatorResolveLocalPath(value);
                try {
                    const st = await fs.stat(p);
                    if (kind === 'video' && st.size > 50 * 1024 * 1024) {
                        const res = await dialog.showMessageBox(mainWindow, {
                            type: 'warning',
                            buttons: ['Embed video', 'Skip video'],
                            defaultId: 0,
                            cancelId: 1,
                            message: 'This video is large. The Page Pack may be heavy.',
                            detail: path.basename(p),
                        });
                        if (res.response === 1) return '';
                    }
                    bytes = await fs.readFile(p);
                    filename = path.basename(p);
                    mime = creatorPackMime(filename);
                } catch {
                    missing.push(value);
                    return value;
                }
            } else {
                return value;
            }
            const id = `${hint || kind}-${assetSeq++}`;
            cloned.assets[id] = { kind, filename: creatorSafeName(filename), mime, data: bytes.toString('base64') };
            return `asset://${id}`;
        };
        page.heroImage = await toAsset(page.heroImage, 'hero', 'image');
        page.posterImage = await toAsset(page.posterImage, 'poster', 'image');
        page.logoImage = await toAsset(page.logoImage, 'logo', 'image');
        if (Array.isArray(page.screenshots)) {
            page.screenshots = await Promise.all(page.screenshots.map(async (s, i) => {
                const row = typeof s === 'string' ? { id: `screenshot-${i + 1}`, url: s } : { ...s };
                row.url = await toAsset(row.url, `screenshot-${i + 1}`, 'image');
                return row;
            }));
        }
        if (Array.isArray(page.trailers)) {
            page.trailers = await Promise.all(page.trailers.map(async (t, i) => {
                const row = typeof t === 'string' ? { id: `trailer-${i + 1}`, url: t } : { ...t };
                const isVideo = /\.(mp4|webm|mov|m4v|ogv)(\?.*)?$/i.test(String(row.url || '')) || row.type === 'direct';
                row.url = await toAsset(row.url, `trailer-${i + 1}`, isVideo ? 'video' : 'image');
                row.thumbUrl = await toAsset(row.thumbUrl, `trailer-thumb-${i + 1}`, 'image');
                row.creatorOwned = true;
                return row;
            }));
        }
        if (missing.length) {
            throw new Error(`Missing local asset(s): ${missing.join(', ')}`);
        }
        cloned.page = page;
        return cloned;
    };
    const creatorDecodeAssets = async (pack, gameKey) => {
        const cloned = JSON.parse(JSON.stringify(pack || {}));
        const assets = cloned.assets || {};
        const safeKey = creatorSafeName(gameKey || cloned.exportedAt || Date.now(), 'page');
        const outDir = path.join(app.getPath('userData'), 'creator-page-assets', safeKey);
        await fs.mkdir(outDir, { recursive: true });
        const assetUrl = async (ref) => {
            if (!ref || typeof ref !== 'string' || !ref.startsWith('asset://')) return ref;
            const id = ref.slice('asset://'.length);
            const asset = assets[id];
            if (!asset?.data) return '';
            const filename = creatorSafeName(asset.filename || `${id}.bin`);
            const outPath = path.join(outDir, `${creatorSafeName(id)}-${filename}`);
            await fs.writeFile(outPath, Buffer.from(asset.data, 'base64'));
            return creatorPathToFileUrl(outPath);
        };
        const page = cloned.page || {};
        page.heroImage = await assetUrl(page.heroImage);
        page.posterImage = await assetUrl(page.posterImage);
        page.logoImage = await assetUrl(page.logoImage);
        if (Array.isArray(page.screenshots)) {
            page.screenshots = await Promise.all(page.screenshots.map(async (s) => {
                const row = typeof s === 'string' ? { url: s } : { ...s };
                row.url = await assetUrl(row.url);
                return row;
            }));
        }
        if (Array.isArray(page.trailers)) {
            page.trailers = await Promise.all(page.trailers.map(async (t) => {
                const row = typeof t === 'string' ? { url: t } : { ...t };
                row.url = await assetUrl(row.url);
                row.thumbUrl = await assetUrl(row.thumbUrl);
                row.importedFromPagePack = true;
                row.creatorOwned = true;
                return row;
            }));
        }
        cloned.page = page;
        return cloned;
    };

    ipcMain.handle('export-creator-page-pack', async (_, defaultName, pagePack) => {
        const result = await dialog.showSaveDialog(mainWindow, {
            defaultPath: defaultName || 'game.baddelpage',
            filters: [
                { name: 'Baddel Page Pack', extensions: ['baddelpage'] },
                { name: 'JSON', extensions: ['json'] },
            ],
        });
        if (result.canceled || !result.filePath) return false;
        const pack = typeof pagePack === 'string' ? JSON.parse(pagePack) : pagePack;
        const embedded = await creatorEmbedAssets(pack);
        await fs.writeFile(result.filePath, JSON.stringify(embedded, null, 2), 'utf8');
        return true;
    });

    ipcMain.handle('import-creator-page-pack', async () => {
        const result = await dialog.showOpenDialog(mainWindow, {
            properties: ['openFile'],
            filters: [
                { name: 'Baddel Page Pack', extensions: ['baddelpage', 'json'] },
            ],
        });
        if (result.canceled || !result.filePaths.length) return null;
        const raw = await fs.readFile(result.filePaths[0], 'utf8');
        return JSON.parse(raw);
    });

    ipcMain.handle('resolve-creator-page-assets', async (_, pagePack, gameKey) => creatorDecodeAssets(pagePack, gameKey));
    ipcMain.handle('export-creator-page', async (_, defaultName, pagePack) => {
        const pack = typeof pagePack === 'string' ? JSON.parse(pagePack) : pagePack;
        return ipcMain.emit ? await (async () => {
            const result = await dialog.showSaveDialog(mainWindow, {
                defaultPath: defaultName || 'game.baddelpage',
                filters: [{ name: 'Baddel Page Pack', extensions: ['baddelpage'] }, { name: 'JSON', extensions: ['json'] }],
            });
            if (result.canceled || !result.filePath) return false;
            const embedded = await creatorEmbedAssets(pack);
            await fs.writeFile(result.filePath, JSON.stringify(embedded, null, 2), 'utf8');
            return true;
        })() : false;
    });
    ipcMain.handle('import-creator-page', async () => {
        const result = await dialog.showOpenDialog(mainWindow, {
            properties: ['openFile'],
            filters: [{ name: 'Baddel Page Pack', extensions: ['baddelpage', 'json'] }],
        });
        if (result.canceled || !result.filePaths.length) return null;
        return JSON.parse(await fs.readFile(result.filePaths[0], 'utf8'));
    });

    // ---- Game Launch ----
ipcMain.handle('launch-game', async (_, command, gameId, gamePath, gameName, options = {}) => {
    // Trust boundary: if gameId is provided, resolve all fields from the trusted
    // games DB and ignore whatever the renderer sent for command/path/name.
    let trusted = null;
    if (gameId) {
        const allGames = getSavedGames();
        trusted = allGames.find(g => String(g.id) === String(gameId)) || null;
        if (!trusted) {
            console.warn('[LaunchGame] gameId not found in trusted DB:', gameId);
            return { status: 'error', code: 'GAME_NOT_FOUND', message: 'Game not found.' };
        }
        command  = trusted.command || trusted.path || '';
        gamePath = trusted.path    || gamePath     || '';
        gameName = trusted.name    || gameName     || '';
        console.log('[LaunchGame] resolved from trusted DB — gameId:', gameId, 'command:', command);
    }

    if (typeof command !== 'string' || !command.trim()) {
        return { status: 'error', code: 'INVALID_COMMAND', message: 'Invalid launch command.' };
    }
    const _cmdParsed = _parseLaunchCommand(command);
    const cleanCmd = _cmdParsed.exePath || String(command || '').replace(/"/g, '').trim();
    const ext      = path.extname(cleanCmd).toLowerCase();

    // ── Diagnostics snapshot ─────────────────────────────────────────────────
    const diag = {
        id:              gameId   || null,
        name:            gameName || null,
        command,
        cleanCmd,
        gamePath:        gamePath || null,
        ext,
        existsCommand:   fsSync.existsSync(cleanCmd),
        existsGamePath:  gamePath ? fsSync.existsSync(gamePath) : false,
        isFile:          null,
        isDirectory:     null,
        shortcutPath:    trusted?.shortcutPath    || null,
        executablePath:  trusted?.executablePath  || null,
        launchArgs:      trusted?.launchArgs      || [],
        launchCwd:       trusted?.launchCwd || trusted?.cwd || gamePath || null,
    };
    try {
        if (diag.existsCommand) {
            const s = fsSync.statSync(cleanCmd);
            diag.isFile      = s.isFile();
            diag.isDirectory = s.isDirectory();
        }
    } catch { /**/ }
    console.log('[LaunchDiag]', diag);

    // Helper: build a structured error and attach diagnostics
    const launchError = (code, message) => ({ status: 'error', code, message, diagnostics: diag });

    // ── Manual game fast path — always shell.openPath, never spawn ──────────
    const isManualGame =
        trusted && (
            trusted.scannerPlatform === 'manual' ||
            trusted.installSource   === 'manual' ||
            trusted.platform        === 'Manual'
        );

    if (isManualGame) {
        let manualLaunchPath = trusted.shortcutPath || trusted.command || cleanCmd;
        // Strip outer quotes just in case
        if (manualLaunchPath.startsWith('"') && manualLaunchPath.endsWith('"')) {
            manualLaunchPath = manualLaunchPath.slice(1, -1).trim();
        }
        console.log('[Launch] Manual game — shell.openPath:', manualLaunchPath);
        if (!fsSync.existsSync(manualLaunchPath)) {
            return {
                status:      'error',
                code:        'PATH_NOT_FOUND',
                message:     `Manual game path not found: ${manualLaunchPath}`,
                diagnostics: {
                    gameId,
                    gameName,
                    manualLaunchPath,
                    command:        trusted.command        || null,
                    shortcutPath:   trusted.shortcutPath   || null,
                    executablePath: trusted.executablePath || null,
                    path:           trusted.path           || null,
                },
            };
        }
        const openErr = await shell.openPath(manualLaunchPath);
        if (openErr) {
            return {
                status:      'error',
                code:        'SHELL_OPENPATH_ERROR',
                message:     openErr,
                diagnostics: {
                    gameId,
                    gameName,
                    manualLaunchPath,
                    command:        trusted.command        || null,
                    shortcutPath:   trusted.shortcutPath   || null,
                    executablePath: trusted.executablePath || null,
                    path:           trusted.path           || null,
                },
            };
        }
        const trackPath = trusted.executablePath || manualLaunchPath;
        startGameTracking(gameId, trusted.command || manualLaunchPath, trackPath, gameName, 'high', true /* userLaunched */);
        analytics.logGameLaunched(_detectPlatform(trusted.command || manualLaunchPath)).catch(() => {});
        return { status: 'success', method: 'manual-shell-openpath' };
    }

    try {
        let launchSuccess = false;

        // ── Branch Xbox/UWP: shell:AppsFolder\PackageFamilyName!App ─────────
        const appsFolderTarget = _extractAppsFolderLaunchTarget(cleanCmd, trusted);

        if (appsFolderTarget) {
            console.log('[Launch] Branch Xbox/UWP — AppsFolder:', appsFolderTarget);

            const result = await _launchAppsFolderTarget(appsFolderTarget);

            if (!result.ok) {
                return launchError(
                    'XBOX_APPSFOLDER_LAUNCH_FAILED',
                    result.error?.message || 'Failed to launch Xbox / Microsoft Store app.'
                );
            }

            startGameTracking(
                gameId,
                command,
                trusted?.path || gamePath,
                gameName,
                'medium',
                true
            );

            analytics.logGameLaunched('xbox').catch(() => {});

            return {
                status: 'success',
                method: 'xbox-appsfolder',
                target: appsFolderTarget,
            };
        }

        // ── EA exe fallback: eadesktop://mobilehome/default is the EA App homepage ──
        // Old DB records may have this generic URL instead of a real game launch command.
        if (/^eadesktop:\/\/mobilehome/i.test(cleanCmd) &&
            trusted?.executablePath &&
            fsSync.existsSync(trusted.executablePath)) {
            console.log('[Launch] EA mobilehome fallback → using executablePath:', trusted.executablePath);
            const eaExe = trusted.executablePath;
            const eaCwd = trusted.launchCwd || path.dirname(eaExe);
            let eaResult;
            try {
                eaResult = await safeLauncher.launchExecutable(eaExe, [], { cwd: eaCwd });
            } catch (err) {
                eaResult = { ok: false, error: err };
            }
            if (!eaResult.ok) {
                return launchError('SPAWN_ERROR', eaResult.error?.message || 'EA executable launch failed');
            }
            startGameTracking(gameId, command, trusted.path || gamePath, gameName, 'high', true);
            analytics.logGameLaunched('ea').catch(() => {});
            return { status: 'success', method: 'ea-exe-fallback' };
        }

        // ── Branch A/B: protocol URLs (steam://, com.epicgames.launcher://, etc.) ──
        if (cleanCmd.includes('://')) {
            const isEpic  = cleanCmd.startsWith('com.epicgames.launcher://');
            const isSteam = cleanCmd.startsWith('steam://');

            const PROCESS_NAMES = {
                // Do NOT include EpicWebHelper here — it may be running in the background
                // while the launcher itself is not yet ready to accept a play command.
                epic:  ['epicgameslauncher.exe'],
                steam: ['steam.exe', 'steamwebhelper.exe'],
            };

            const platformKey = isEpic ? 'epic' : isSteam ? 'steam' : null;
            const names       = platformKey ? PROCESS_NAMES[platformKey] : [];

            const launchKey = `${platformKey || 'protocol'}:${cleanCmd}`;
            if (_launchInFlight.has(launchKey)) {
                console.log(`[Launch] Already in-flight, ignoring duplicate: ${launchKey}`);
                return { status: 'success', duplicate: true };
            }

            _launchInFlight.add(launchKey);
            try {
                const wasRunning        = platformKey ? await _launcherIsRunning(names) : false;
                const forceRetryAfterOpen = !!options.forceRetryAfterOpen;

                const openProtocol = async (url, reason = 'play') => {
                    console.log(`[Launch] open protocol (${reason})`, { platformKey, url });
                    try {
                        if (typeof _openProtocolUrlReliable === 'function') {
                            await _openProtocolUrlReliable(url, `play-${reason}`);
                        } else {
                            await safeLauncher.openProtocolUrl(url);
                        }
                    } catch { await safeLauncher.openProtocolUrl(url); }
                };

                if (platformKey) {
                    const launcherInfo = await _getExternalLauncherInfo(platformKey);
                    if (!launcherInfo.available) {
                        return {
                            success:  false,
                            status:   'error',
                            code:     launcherInfo.code,
                            platform: platformKey,
                            message:  launcherInfo.message,
                            error:    launcherInfo.message,
                            diagnostics: diag,
                        };
                    }
                }

                if (isEpic) {
                    const epicPlayResult = await _openEpicPlayUrlWithColdStartRecovery(cleanCmd, wasRunning);
                    launchSuccess = true;
                    console.log('[Launch] Epic play dispatch complete', epicPlayResult);
                } else {
                    await openProtocol(cleanCmd, `${platformKey || 'custom'}-warm-play`);
                    launchSuccess = true;
                    if (platformKey && forceRetryAfterOpen) {
                        const appeared = await _waitForLauncherProcess(names, 25000, 1000);
                        if (appeared) {
                            const graceMs = 7000;
                            console.log(`[Launch] retry ${platformKey}, forceRetry=${forceRetryAfterOpen}, grace=${graceMs}`);
                            await new Promise(r => setTimeout(r, graceMs));
                            await openProtocol(cleanCmd, `${platformKey}-force-retry`);
                        }
                    }
                }
            } finally {
                setTimeout(() => _launchInFlight.delete(launchKey), isEpic ? 70000 : 5000);
            }

        // ── Branch A: prefer stored shortcutPath (preserves Windows shortcut args/cwd) ──
        } else if (trusted?.shortcutPath && fsSync.existsSync(trusted.shortcutPath)) {
            console.log('[Launch] Branch A — shortcutPath:', trusted.shortcutPath);
            const err = await shell.openPath(trusted.shortcutPath);
            if (err) return launchError('SHELL_OPENPATH_ERROR', `shell.openPath failed: ${err}`);
            launchSuccess = true;

        // ── Branch B: .lnk without stored shortcutPath ───────────────────────
        } else if (ext === '.lnk') {
            console.log('[Launch] Branch B — .lnk openPath:', cleanCmd);
            if (!diag.existsCommand) return launchError('PATH_NOT_FOUND', `Shortcut not found: ${cleanCmd}`);
            const err = await shell.openPath(cleanCmd);
            if (err) return launchError('SHELL_OPENPATH_ERROR', `shell.openPath failed: ${err}`);
            launchSuccess = true;

        // ── Branch C: .url file — parse URL= line and open via safeLauncher ──
        } else if (ext === '.url') {
            console.log('[Launch] Branch C — .url file:', cleanCmd);
            if (!diag.existsCommand) return launchError('PATH_NOT_FOUND', `URL file not found: ${cleanCmd}`);
            let urlTarget = null;
            try {
                const urlContents = fsSync.readFileSync(cleanCmd, 'utf8');
                const urlMatch = urlContents.match(/^URL=(.+)$/im);
                if (urlMatch) urlTarget = urlMatch[1].trim();
            } catch (e) {
                return launchError('PATH_NOT_FOUND', `Could not read .url file: ${e.message}`);
            }
            if (!urlTarget) return launchError('INVALID_COMMAND', 'No URL= found in .url file.');
            try {
                await safeLauncher.openProtocolUrl(urlTarget);
                launchSuccess = true;
            } catch (e) {
                return launchError('SHELL_OPENPATH_ERROR', `Protocol open failed: ${e.message}`);
            }

        // ── Branch D: .exe — direct spawn with stored args and cwd ──────────
        } else if (ext === '.exe') {
            console.log('[Launch] Branch D — .exe spawn:', cleanCmd);
            if (!diag.existsCommand) return launchError('PATH_NOT_FOUND', `Executable not found: ${cleanCmd}`);
            const spawnArgs = (trusted?.launchArgs?.length) ? trusted.launchArgs : (_cmdParsed.parsedArgs || []);
            let spawnCwd;
            try {
                const s = diag.launchCwd ? fsSync.statSync(diag.launchCwd) : null;
                spawnCwd = (s && s.isDirectory()) ? diag.launchCwd : path.dirname(cleanCmd);
            } catch { spawnCwd = path.dirname(cleanCmd); }
            let spawnResult;
            try {
                spawnResult = await safeLauncher.launchExecutable(cleanCmd, spawnArgs, { cwd: spawnCwd });
            } catch (err) {
                spawnResult = { ok: false, error: err };
            }
            if (!spawnResult.ok) {
                const msg = spawnResult.error?.message || 'Spawn failed';
                console.error('[Launch] Branch D spawn failed:', msg, 'cmd:', cleanCmd, 'args:', spawnArgs);
                return launchError('SPAWN_ERROR', msg);
            }
            launchSuccess = true;

        } else {
            return launchError('EXT_NOT_SUPPORTED', `Unsupported launch file type: ${ext || '(no extension)'}`);
        }

        if (launchSuccess) {
            startGameTracking(gameId, command, gamePath, gameName, 'high', true /* userLaunched */);
            analytics.logGameLaunched(_detectPlatform(command)).catch(() => {});
            return { status: 'success' };
        }
        return launchError('SPAWN_ERROR', 'Failed to start game process.');

    } catch (err) {
        console.error('[Launch Error]', err);
        return launchError('SPAWN_ERROR', err.message || 'Game not found or protocol not registered.');
    }
});

function _normalizePlatformHints(hints = {}) {
    const plats = new Set();
    const rawPlatforms = Array.isArray(hints.platforms)
        ? hints.platforms
        : (typeof hints.platform === 'string' ? hints.platform.split(',') : []);

    rawPlatforms.forEach((p) => {
        const key = String(p || '').toLowerCase().trim();
        if (key) plats.add(key);
    });

    if (!rawPlatforms.length) {
        const src = `${hints.platform || ''} ${hints.command || ''} ${hints.path || ''}`.toLowerCase();
        if (src.includes('steam')) plats.add('steam');
        if (src.includes('epic')) plats.add('epic');
        if (src.includes('ea') || src.includes('origin')) plats.add('ea');
        if (src.includes('riot')) plats.add('riot');
        if (src.includes('ubisoft')) plats.add('ubisoft');
        if (src.includes('rockstar')) plats.add('rockstar');
    }

    return [...plats];
}

function _isSteamHostedImageUrl(url) {
    if (!url || typeof url !== 'string') return false;
    return /steam(static|powered)|akamaihd\.net\/steam|steamcdn/i.test(url);
}

function _extractSteamAppId(gameName, hints = {}) {
    const candidates = [
        hints.steamAppId,
        hints?.allIds?.steam,
        hints.id,
        hints.command,
    ];
    for (const raw of candidates) {
        const m = String(raw || '').match(/(\d{3,})/);
        if (m) return m[1];
    }
    return null;
}

function _decodeHtmlEntities(input = '') {
    return String(input)
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>');
}

function _stripHtmlToText(input = '') {
    const text = String(input)
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|li|ul|ol|h1|h2|h3|h4|h5|h6)>/gi, '\n')
        .replace(/<li[^>]*>/gi, '• ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\r/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();
    return _decodeHtmlEntities(text);
}

function _normalizeSteamDescription(data = {}) {
    const shortDesc = _stripHtmlToText(data.short_description || '');
    if (shortDesc.length >= 80) return shortDesc;

    const longDesc = _stripHtmlToText(data.about_the_game || data.detailed_description || '');
    if (!longDesc) return shortDesc || null;

    // Keep it readable and story-first (avoid very long storefront dump)
    if (longDesc.length <= 1400) return longDesc;
    return `${longDesc.slice(0, 1400).trim()}...`;
}

function _parseStorefrontRequirements(html = '') {
    if (!html) return {};
    const text = _stripHtmlToText(html);
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const joined = lines.join('\n');

    const pick = (labelRegex) => {
        const re = new RegExp(`${labelRegex}\\s*:?[\\s\\n]*([^\\n]+)`, 'i');
        const m = joined.match(re);
        return m ? m[1].trim() : null;
    };

    return {
        os: pick('(?:OS|Operating\\s*System)'),
        cpu: pick('(?:Processor|CPU)'),
        ram: pick('(?:Memory|RAM)'),
        gpu: pick('(?:Graphics|Video\\s*Card|GPU)'),
        storage: pick('(?:Storage|Hard\\s*Drive|Disk\\s*Space)'),
        directx: pick('(?:DirectX|DX)'),
    };
}

const _achievementsResultCache = new Map();
const ACHIEVEMENTS_CACHE_TTL_MS = 90_000;

function _normalizeAccountIdList(values = []) {
    return [...new Set((Array.isArray(values) ? values : []).map((v) => String(v || '').trim()).filter(Boolean))];
}

function _extractOwnerAccountIdsFromPayload(payload = {}) {
    const allIds = payload?.allIds && typeof payload.allIds === 'object' ? payload.allIds : {};
    const steamHintId = allIds?.steam ? String(allIds.steam) : null;
    const ownerIds = _normalizeAccountIdList(payload?.ownerAccountIds || []);
    return { ownerIds, steamHintId };
}

async function _fetchAchievementsForApp(payload = {}) {
    const normalizedAppId = String(payload?.appId || '').match(/(\d{3,})/)?.[1] || null;
    if (!normalizedAppId) return { status: 'error', message: 'Invalid Steam app id' };
    const withTimeout = (promise, ms, label) => Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
    ]);

    const accounts = steamConnector?.getAccounts?.() || [];
    if (!accounts.length) {
        return { status: 'success', appId: normalizedAppId, accounts: [] };
    }

    const { ownerIds, steamHintId } = _extractOwnerAccountIdsFromPayload(payload);
    const cacheKey = `${normalizedAppId}|${accounts.map((a) => String(a.id)).sort().join(',')}|${ownerIds.sort().join(',')}`;
    const cached = _achievementsResultCache.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < ACHIEVEMENTS_CACHE_TTL_MS) {
        return cached.value;
    }

    await steamBridge.start();
    let activeSessionId = String(steamBridge.getLastSessionSteamId?.() || '');
    const allCreds = steamBridge.getAllSavedCredentials?.() || {};

    console.log(`[Achievements] ▶ app=${normalizedAppId} accounts=${accounts.length} ownerIds=[${ownerIds.join(',')}]`);

    // Bootstrap auth once if bridge has no active session yet.
    if (!activeSessionId) {
        const firstCred = Object.values(allCreds)[0] || null;
        if (firstCred) {
            try {
                console.log(`[Achievements] BOOTSTRAP ▶`);
                const boot = await withTimeout(
                    steamBridge.authenticate(firstCred, { waitForCache: false }),
                    12000,
                    'Steam auth bootstrap'
                );
                if (boot?.status === 'authenticated' && boot?.steamId) {
                    activeSessionId = String(boot.steamId);
                    console.log(`[Achievements] BOOTSTRAP ◀ session=${activeSessionId}`);
                }
            } catch (e) {
                console.warn(`[Achievements] BOOTSTRAP failed: ${e.message}`);
            }
        }
    }
    // Single Python bridge session cannot safely authenticate multiple accounts in parallel.
    // Running this sequentially avoids cross-account session bleed (same achievements on all rows).
    const rows = [];
    for (const account of accounts) {
        const accountId = String(account.id);
        const displayName = account.displayName || accountId;
        const shouldOwnGame = ownerIds.length === 0 || ownerIds.includes(accountId);
        try {
            if (!shouldOwnGame) {
                rows.push({
                    accountId,
                    displayName,
                    unlockedCount: 0,
                    unlocked: [],
                    skipped: true,
                    error: 'Game not owned by this account',
                });
                continue;
            }

            const creds = steamBridge.getCredentialsForAccount(accountId);
            let authenticated = false;
            let didSwitch = false;

            if (creds) {
                if (activeSessionId && activeSessionId === accountId) {
                    authenticated = true;
                } else {
                    let authRes;
                    try {
                        console.log(`[Achievements] AUTH ▶ ${displayName} (from ${activeSessionId || 'none'})`);
                        authRes = await withTimeout(
                            steamBridge.authenticate(creds, { waitForCache: false }),
                            20000,
                            `Steam auth (${displayName})`
                        );
                        console.log(`[Achievements] AUTH ◀ ${displayName} status=${authRes?.status} steamId=${authRes?.steamId ?? 'n/a'}`);
                    } catch (e) {
                        console.warn(`[Achievements] AUTH timeout/error ${displayName}: ${e.message}`);
                    }
                    authenticated = authRes?.status === 'authenticated' && String(authRes?.steamId || '') === accountId;
                    if (authenticated) {
                        activeSessionId = accountId;
                        didSwitch = true;
                    }
                }
            } else if (activeSessionId && activeSessionId === accountId) {
                authenticated = true;
            }

            if (!authenticated) {
                rows.push({
                    accountId,
                    displayName,
                    unlockedCount: 0,
                    unlocked: [],
                    error: 'Not authenticated',
                });
                continue;
            }

            // After switching to a different account, wait for the session/cache to stabilise
            // before requesting achievements. This mirrors the library-sync pattern and prevents
            // fetching against a transitioning Python session.
            if (didSwitch) {
                console.log(`[Achievements] CACHE ⏳ ${displayName} — waiting for session ready`);
                await steamBridge.waitForCacheReady(accountId, 35_000);
                console.log(`[Achievements] CACHE ✅ ${displayName} — session ready`);
            }

            // Guard against stale session switching.
            const currentSessionId = String(steamBridge.getLastSessionSteamId?.() || '');
            if (currentSessionId && currentSessionId !== accountId) {
                console.warn(`[Achievements] Session mismatch — expected ${accountId}, got ${currentSessionId}`);
                rows.push({
                    accountId,
                    displayName,
                    unlockedCount: 0,
                    unlocked: [],
                    error: 'Session mismatch',
                });
                continue;
            }

            // 120s per-account budget — must exceed Python's wait_ready(60) + wait_metadata_ready(30)
            // which can take up to 90s on a cold CM connection. The bridge itself allows 180s;
            // this 120s safety net sits between the two so a genuinely hung account fails
            // individually without consuming the entire outer UI timeout.
            console.log(`[Achievements] FETCH ▶ ${displayName} app=${normalizedAppId}`);
            const achRes = await withTimeout(
                steamBridge.getAchievements([normalizedAppId]),
                120_000,
                `Steam achievements (${displayName}, app ${normalizedAppId})`
            );
            const unlocked = Array.isArray(achRes?.achievements?.[normalizedAppId])
    ? achRes.achievements[normalizedAppId]
    : [];

// الجديد: كل الإنجازات من Steam schema
const allSchemaAchievements =
    Array.isArray(achRes?.allAchievements?.[normalizedAppId])
        ? achRes.allAchievements[normalizedAppId]
        : (
            Array.isArray(achRes?.achievementSchema?.[normalizedAppId])
                ? achRes.achievementSchema[normalizedAppId]
                : []
        );

const normalizeAchKey = (value) => String(value || '')
    .toLowerCase()
    .replace(/[™®©]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const unlockedByKey = new Map();

for (const u of unlocked) {
    const keys = [
        u.internalName,
        u.internal_name,
        u.name,
        u.localized_name,
    ].map(normalizeAchKey).filter(Boolean);

    for (const key of keys) {
        if (!unlockedByKey.has(key)) unlockedByKey.set(key, u);
    }
}

const allAchievements = allSchemaAchievements.length
    ? allSchemaAchievements.map((a) => {
        const keys = [
            a.internalName,
            a.internal_name,
            a.name,
            a.localized_name,
        ].map(normalizeAchKey).filter(Boolean);

        const unlockedMatch = keys.map(k => unlockedByKey.get(k)).find(Boolean) || null;
        const isUnlocked = !!unlockedMatch;

        return {
            internalName: a.internalName || a.internal_name || null,
            name: a.name || a.localized_name || a.localizedName || unlockedMatch?.name || 'Achievement',
            description: a.description || a.localized_desc || a.localizedDesc || unlockedMatch?.description || '',
            icon: a.icon || unlockedMatch?.icon || '',
            iconGray: a.iconGray || a.icon_gray || a.icon_gray_url || a.icon || '',
            hidden: a.hidden === true,
            playerPercentUnlocked: a.playerPercentUnlocked ?? a.player_percent_unlocked ?? null,

            unlocked: isUnlocked,
            unlockTime: Number(unlockedMatch?.unlockTime || unlockedMatch?.unlock_time || 0) || 0,
        };
    })
    : unlocked.map((u) => ({
        internalName: u.internalName || u.internal_name || null,
        name: u.name || u.localized_name || 'Achievement',
        description: u.description || u.localized_desc || '',
        icon: u.icon || '',
        iconGray: u.iconGray || u.icon_gray || u.icon || '',
        hidden: false,
        playerPercentUnlocked: u.playerPercentUnlocked ?? u.player_percent_unlocked ?? null,
        unlocked: true,
        unlockTime: Number(u.unlockTime || u.unlock_time || 0) || 0,
    }));

    const totalCount =
        Number(achRes?.progress?.[normalizedAppId]?.totalCount) ||
        allAchievements.length ||
        null;

    const unlockedCount = allAchievements.length
        ? allAchievements.filter(a => a.unlocked).length
        : unlocked.length;

    console.log(
        `[Achievements] FETCH ◀ ${displayName} unlocked=${unlockedCount} total=${totalCount ?? 'unknown'} all=${allAchievements.length}`
    );

    rows.push({
        accountId,
        displayName,
        totalCount,
        unlockedCount,

        // القديم نسيبه للتوافق
        unlocked,

        // الجديد
        allAchievements,

        unlockedPreview: allAchievements
            .filter(a => a.unlocked)
            .slice()
            .sort((a, b) => Number(b.unlockTime || 0) - Number(a.unlockTime || 0)),
    });
        } catch (err) {
            console.error(`[Achievements] ERROR ${displayName}: ${err.message}`);
            rows.push({
                accountId,
                displayName,
                unlockedCount: 0,
                unlocked: [],
                error: err?.message || 'Failed to load achievements',
            });
        }
    }
    console.log(`[Achievements] ◀ app=${normalizedAppId} rows=${rows.length} ok=${rows.filter(r => !r.error && !r.skipped).length}`);

    rows.sort((a, b) => b.unlockedCount - a.unlockedCount);
    const result = { status: 'success', appId: normalizedAppId, accounts: rows };
    _achievementsResultCache.set(cacheKey, { ts: Date.now(), value: result });
    return result;
}

async function _findSteamAppIdByName(gameName) {
    try {
        const searchRes = await fetch(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(gameName)}&l=english&cc=US`);
        const searchData = await searchRes.json();
        if (!searchData.items || searchData.items.length === 0) return null;
        return String(searchData.items[0].id);
    } catch {
        return null;
    }
}

async function _fetchSteamReviewSummary(appId) {
    try {
        const res = await fetch(`https://store.steampowered.com/appreviews/${appId}?json=1&language=all&purchase_type=all`);
        const data = await res.json();
        const summary = data?.query_summary || {};
        const totalPositive = Number(summary.total_positive || 0);
        const totalNegative = Number(summary.total_negative || 0);
        const total = totalPositive + totalNegative;
        const scorePercent = total > 0 ? Math.round((totalPositive / total) * 100) : null;

        return {
            reviewScore: typeof summary.review_score === 'number' ? summary.review_score : null,
            reviewScoreDesc: summary.review_score_desc || null,
            totalPositive,
            totalNegative,
            totalReviews: total,
            scorePercent,
        };
    } catch {
        return null;
    }
}

// Steam Storefront (details + trailer + requirements). Card/hero: Store API images first, then CDN.
async function fetchSteamStorefrontData(gameName, hints = {}) {
    const _pickSteamMovieUrl = (movie = {}) => (
        movie?.mp4?.max ||
        movie?.mp4?.['480'] ||
        movie?.webm?.max ||
        movie?.webm?.['480'] ||
        movie?.hls_h264 ||
        movie?.dash_h264 ||
        movie?.dash_av1 ||
        null
    );

    // Returns an ordered array of all available sources for one Steam movie.
    // Electron/Chromium plays WebM (VP9) and MP4 (H.264) natively; HLS/DASH need JS libs.
    // Prefer WebM > MP4 > HLS > DASH so native formats are tried first.
    const _pickSteamMovieSources = (movie = {}) => {
        const push = (url, kind, label) => url ? { url, kind, label } : null;
        return [
            push(movie?.webm?.max,    'webm', 'WebM Max'),
            push(movie?.webm?.['480'],'webm', 'WebM 480p'),
            push(movie?.mp4?.max,     'mp4',  'MP4 Max'),
            push(movie?.mp4?.['480'], 'mp4',  'MP4 480p'),
            push(movie?.hls_h264,     'hls',  'HLS'),
            push(movie?.dash_h264,    'dash', 'DASH H.264'),
            push(movie?.dash_av1,     'dash', 'DASH AV1'),
        ].filter(Boolean);
    };

    const _emptySteamInfo = (reviewSummary) => ({
        description: null,
        genres: [],
        developer: null,
        publisher: null,
        releaseDate: null,
        rating: null,
        platforms: [],
        engine: null,
        gameMode: null,
        website: null,
        trailer: null,
        allTrailers: [],
        isDirectVideo: false,
        artworks: [],
        screenshots: [],
        requirements: null,
        steamReview: reviewSummary,
        achievementsTotal: null,
    });

    try {
        const appId = _extractSteamAppId(gameName, hints) || await _findSteamAppIdByName(gameName);
        if (!appId) return null;

        const [detailsRes, reviewSummary] = await Promise.all([
            fetch(`https://store.steampowered.com/api/appdetails?appids=${appId}`, {
                headers: {
                    'Cookie': 'birthtime=283993201; lastagecheckage=1-January-1980; mature_content=1; wants_mature_content=1'
                }
            }),
            _fetchSteamReviewSummary(appId),
        ]);
        let detailsData = null;
        try {
            detailsData = await detailsRes.json();
        } catch {
            detailsData = null;
        }
        const appKey = String(appId);
        if (!detailsData || typeof detailsData !== 'object') {
            return {
                cover: null,
                heroImage: null,
                logo: null,
                steamAppId: appId,
                steamStoreCoverUrls: [],
                steamStoreHeroUrls: [],
                steamStoreLogoUrls: [],
                usedSteamLibraryGridArt: false,
                storeCapsuleFallback: null,
                storeHeroFallback: null,
                info: _emptySteamInfo(reviewSummary),
            };
        }
        const ok = !!detailsData[appKey]?.success;
        const data = ok ? detailsData[appKey].data : null;

        if (!data) {
            return {
                cover: null,
                heroImage: null,
                logo: null,
                steamAppId: appId,
                steamStoreCoverUrls: [],
                steamStoreHeroUrls: [],
                steamStoreLogoUrls: [],
                usedSteamLibraryGridArt: false,
                storeCapsuleFallback: null,
                storeHeroFallback: null,
                info: _emptySteamInfo(reviewSummary),
            };
        }

        const trailer = _pickSteamMovieUrl(data.movies?.[0] || null);
        const allTrailers = (data.movies || []).map((movie, i) => {
            const sources = _pickSteamMovieSources(movie);
            return {
                name: movie?.name || `Trailer ${i + 1}`,
                url: sources[0]?.url || _pickSteamMovieUrl(movie),
                thumbUrl: movie?.thumbnail || null,
                sources,
            };
        }).filter((t) => !!t.url);

        const screenshots = (data.screenshots || []).map((s) => s.path_full || s.path_thumbnail).filter(Boolean);
        let requirements = null;
        if (data.pc_requirements) {
            const minimum = _parseStorefrontRequirements(data.pc_requirements.minimum || '');
            const recommended = _parseStorefrontRequirements(data.pc_requirements.recommended || '');
            const hasAny = Object.values(minimum).some(Boolean) || Object.values(recommended).some(Boolean);
            requirements = hasAny ? { minimum, recommended } : null;
        }

        const storeCoverFallbacks = [
            data.capsule_image,
            data.capsule_imagev5,
            data.header_image,
            screenshots[0],
        ].filter(Boolean);
        const storeHeroFallbacks = [
            data.background_raw,
            data.background,
            screenshots[0],
            data.capsule_imagev5,
            data.header_image,
        ].filter(Boolean);
        const storeLogoFallbacks = [
            data.header_image,
            data.capsule_imagev5,
            data.capsule_image,
            data.background_raw,
            screenshots[0],
        ].filter(Boolean);

        return {
            cover: null,
            heroImage: null,
            logo: null,
            steamAppId: appId,
            steamStoreCoverUrls: storeCoverFallbacks,
            steamStoreHeroUrls: storeHeroFallbacks,
            steamStoreLogoUrls: storeLogoFallbacks,
            usedSteamLibraryGridArt: false,
            storeCapsuleFallback: data.capsule_image || data.header_image || screenshots[0] || null,
            storeHeroFallback: data.background_raw || data.background || data.capsule_imagev5 || data.header_image || null,
            info: {
                description: _normalizeSteamDescription(data),
                genres: (data.genres || []).map((g) => g.description).filter(Boolean),
                developer: Array.isArray(data.developers) ? data.developers.join(', ') : null,
                publisher: Array.isArray(data.publishers) ? data.publishers.join(', ') : null,
                releaseDate: data.release_date?.date || null,
                rating: typeof data.metacritic?.score === 'number' ? data.metacritic.score : null,
                platforms: Object.entries(data.platforms || {})
                    .filter(([, val]) => !!val)
                    .map(([k]) => k.toUpperCase()),
                engine: null,
                gameMode: null,
                website: data.website || null,
                trailer,
                allTrailers,
                isDirectVideo: !!trailer,
                artworks: [],
                screenshots,
                requirements,
                steamReview: reviewSummary,
                achievementsTotal: Number(data.achievements?.total || 0) || null,
            },
        };
    } catch (err) {
        console.error('[Steam Storefront Fetch Error]', err);
        const appId = _extractSteamAppId(gameName, hints);
        if (!appId) return null;
        return {
            cover: null,
            heroImage: null,
            logo: null,
            steamAppId: appId,
            steamStoreCoverUrls: [],
            steamStoreHeroUrls: [],
            steamStoreLogoUrls: [],
            usedSteamLibraryGridArt: false,
            storeCapsuleFallback: null,
            storeHeroFallback: null,
            info: _emptySteamInfo(null),
        };
    }
}

// ============================================================
// EPIC NAME MAPPING
// ============================================================
// Known Epic internal names → real searchable game names
const EPIC_NAME_MAP = {
    'death stranding content':          'Death Stranding',
    'gta v':                            'Grand Theft Auto V',
    'gtav':                             'Grand Theft Auto V',
    'among us inner sloth':             'Among Us',
    'rocket league psyonix':            'Rocket League',
    'fortnite battle royale':           'Fortnite',
    'diabloiiiretailue':                'Diablo III',
    'rage 2 bethesda':                  'RAGE 2',
    'theouterworlds':                   'The Outer Worlds',
    'borderlands3':                     'Borderlands 3',
    'cyberpunk2077':                    'Cyberpunk 2077',
    'readyornot':                       'Ready or Not',
    'remnant2':                         'Remnant II',
    'calluna':                          'Control',
};

/**
 * _searchLegendaryMetadataByAnyName(name)
 * 1. Finds the matching game in Legendary's local metadata JSON files (gives us
 *    app_title, app_name, namespace — the identifiers we need).
 * 2. Uses those identifiers to call fetchFromEpicStore(), which hits Epic's
 *    public store-content API and returns cover, hero, logo, description,
 *    screenshots, system requirements, trailers, and more.
 * 3. Falls back to the local keyImages (offline) if the network call fails.
 */
async function _searchLegendaryMetadataByAnyName(gameName) {
    try {
        const userData = app.getPath('userData');
        const items = await fs.readdir(userData);
        const legendaryDirs = items.filter(d => d.startsWith('legendary-config-'));
        const target = gameName.toLowerCase().replace(/[^a-z0-9]/g, '');

        for (const dir of legendaryDirs) {
            const metaDir = path.join(userData, dir, 'metadata');
            if (!require('fs').existsSync(metaDir)) continue;

            const files = await fs.readdir(metaDir);
            for (const file of files) {
                if (!file.endsWith('.json')) continue;
                try {
                    const raw = await fs.readFile(path.join(metaDir, file), 'utf8');
                    const data = JSON.parse(raw);
                    const rawTitle = (data.app_title || data.app_name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                    const rawName  = (data.app_name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                    const mappedTitle = EPIC_NAME_MAP[rawName]?.toLowerCase().replace(/[^a-z0-9]/g, '') || '';

                    // Match logic: exact match only or mapping match.
                    // Avoid fuzzy includes which causes false positives (e.g. empty string matches everything).
                    const isMatch = (target.length > 0) && (
                        (rawTitle === target) ||
                        (rawName === target) ||
                        (mappedTitle === target)
                    );

                    if (isMatch) {
                        // Build the legendaryGame object the new API expects
                        const legendaryGame = {
                            app_title: data.app_title || data.app_name || '',
                            app_name:  data.app_name  || '',
                            metadata:  { namespace: data.metadata?.namespace || data.app_name || '' },
                        };

                        // Try the live store-content API first (full metadata)
                        try {
                            const storeResult = await fetchFromEpicStore(legendaryGame);
                            if (storeResult) {
                                console.log(`[Legendary] store-content OK for "${legendaryGame.app_title}"`);
                                return storeResult; // { cover, heroImage, logo, info: { ... } }
                            }
                        } catch (apiErr) {
                            console.warn('[Legendary] store-content failed, using local keyImages:', apiErr.message);
                        }

                        // Offline fallback: local keyImages only (no description/screenshots)
                        const keyImages = data.metadata?.keyImages || [];
                        return {
                            cover:     _pickEpicCover(keyImages),
                            hero:      _pickEpicHero(keyImages),
                            heroImage: _pickEpicHero(keyImages),
                            logo:      _pickEpicLogo(keyImages),
                        };
                    }
                } catch { /* skip corrupted json */ }
            }
        }
    } catch (err) {
        // quiet
    }
    return null;
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

function _pickEpicHero(keyImages) {
    if (!Array.isArray(keyImages) || keyImages.length === 0) return null;
    const PREF = ['DieselGameBox', 'OfferImageWide', 'Featured', 'Thumbnail'];
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

function _cleanNameForSearch(name) {
    if (!name) return { full: '', short: '' };

    // Check Epic internal name map first (before any cleaning)
    const lowerName = name.toLowerCase().trim();
    if (EPIC_NAME_MAP[lowerName]) {
        const mapped = EPIC_NAME_MAP[lowerName];
        return { full: mapped, short: null };
    }

    // Strip trailing " Content" / " DLC Content" — Epic internal suffix
    // e.g. "Death Stranding Content" → "Death Stranding"
    let clean = name
        .replace(/\s+Content\s*$/i, '')
        .replace(/\s+DLC\s*$/i, '')
        .replace(/\(.*\)/g, '')
        .replace(/\[.*\]/g, '')
        .replace(/®|™|©/g, '');

    const suffixes = [
        'Editor', 'Dedicated Server', 'Beta', 'Trial', 
        'Demo', 'Alpha', 'Development Kit', 'SDK', 'Public Test', 
        'Test Branch', 'Test Edition', 'Server'
    ];
    // NOTE: 'Mod Kit' intentionally excluded — "Hello Mod Kit" is the actual product name,
    // stripping it would leave "Hello" which matches a completely unrelated IGDB game.
    
    suffixes.forEach(s => {
        const reg = new RegExp(`\\s+${s}$`, 'i');
        clean = clean.replace(reg, '');
    });

    clean = clean.trim();

    // 3D City: Metaverse -> 3D City
    // Fallback to short name (series name) if colon or dash exists
    let short = clean;
    if (clean.includes(':'))   short = clean.split(':')[0].trim();
    else if (clean.includes(' - ')) short = clean.split(' - ')[0].trim();

    return { 
        full: clean, 
        short: (short !== clean && short.length > 2) ? short : null 
    };
}

// ─── Platform hint mapper ─────────────────────────────────────────────────────
// Maps raw launcher platform strings to the server-accepted `platformHint` values
// for POST /client/resolve-metadata.  Unknown values return null (field omitted).
function _mapPlatformHint(raw) {
    if (!raw) return null;
    const p = raw.toLowerCase().trim();
    if (p === 'xbox' || p === 'xbox game pass' || p === 'microsoft store' || p === 'store') return 'xbox';
    if (p === 'ea app' || p === 'ea' || p === 'origin')                                     return 'ea';
    if (p === 'ubisoft connect' || p === 'ubisoft')                                          return 'ubisoft';
    if (p === 'riot games' || p === 'riot')                                                  return 'riot';
    if (p === 'rockstar' || p === 'rockstar games')                                          return 'rockstar';
    if (p === 'gog')                                                                         return 'gog';
    if (p === 'battlenet' || p === 'battle.net')                                             return 'battlenet';
    return null; // steam/epic never reach this path; unknown → omit field
}

function _canonicalSteamEpicId(platform, hints = {}) {
    const p = String(platform || '').toLowerCase().trim();

    if (p === 'steam') {
        const raw =
            hints.allIds?.steam ||
            hints.appid ||
            hints.appId ||
            hints.steamAppId ||
            hints.id;

        const cleaned = String(raw || '')
            .replace(/^steam[-_]/i, '')
            .trim();

        return /^\d+$/.test(cleaned) ? cleaned : null;
    }

    if (p === 'epic') {
        const raw =
            hints.allIds?.epic ||
            hints.namespace ||
            hints.catalogNamespace ||
            hints.epicNamespace;

        const cleaned = String(raw || '')
            .replace(/^epic[-_]/i, '')
            .trim();

        if (cleaned.length >= 10 && /^[a-z0-9-]+$/i.test(cleaned)) {
            return cleaned;
        }

        return null;
    }

    return null;
}

    // ---- Metadata ----
// All metadata now comes from Baddel API server
ipcMain.handle('get-game-metadata', async (_, originalGameName, hints = {}) => {
    try {
        let platform = (hints.platform || '').toLowerCase().trim();
        let id = hints.id || null;

        // Normalize platform aliases
        if (platform === 'steam_app') platform = 'steam';
        if (platform === 'epic' || platform === 'epic games' || platform === 'epic_games') platform = 'epic';

        // ── Steam / Epic path: lookup → enrich-request → server-pending ──────
        const STEAM_EPIC = new Set(['steam', 'epic']);

        const canonicalId = _canonicalSteamEpicId(platform, {
            ...hints,
            id
        });

        if (platform && canonicalId && STEAM_EPIC.has(platform)) {
            console.log(`[get-game-metadata] Steam/Epic canonical lookup: ${platform}/${canonicalId}`);

            let serverGame = await baddelApi.lookupGame({
                platform,
                id: canonicalId
            });

            if (!serverGame) {
                console.log(`[get-game-metadata] Steam/Epic miss — requesting enrich for ${platform} ID: ${canonicalId}`);

                baddelApi
                    .requestGameEnrich(platform, canonicalId, originalGameName)
                    .catch(() => {});

                return {
                    _serverData: {
                        pending: true,
                        platform,
                        externalId: canonicalId
                    },
                    source: 'server-pending',
                    info: {
                        screenshots: [],
                        artworks: [],
                        allTrailers: []
                    }
                };
            }

            console.log(`[get-game-metadata] Steam/Epic hit: ${platform}/${canonicalId}`);
            return baddelApi.normalizeServerData(serverGame);
        }

        // ── Platform/ID pre-lookup for Ubisoft/EA/Xbox games that also have Epic or Steam IDs ──
        // Games like Rainbow Six Siege have platform='ubisoft' but launch via Epic.
        // The early STEAM_EPIC check above is skipped because platform !== 'epic'.
        // Try a direct platform/id lookup using allIds, namespace, or launcherGameId before MRM.
        {
            const epicId = hints.allIds?.epic
                || hints.namespace
                || (typeof (hints.id || '') === 'string' && /^epic[-_]/i.test(hints.id || '') ? String(hints.id).replace(/^epic[-_]/i, '') : null);
            if (epicId) {
                const cleanEpicId = String(epicId).replace(/^epic[-_]/i, '');
                console.log(`[get-game-metadata] trying platform/id lookup: epic/${cleanEpicId}`);
                try {
                    const hit = await baddelApi.lookupGame({ platform: 'epic', id: cleanEpicId });
                    if (hit) {
                        console.log(`[get-game-metadata] platform/id hit: epic/${cleanEpicId}`);
                        return baddelApi.normalizeServerData(hit);
                    }
                    console.log(`[get-game-metadata] platform/id miss: epic/${cleanEpicId}`);
                } catch (_e) { /* continue to MRM */ }
            }

            const steamId = hints.allIds?.steam
                || (typeof (hints.id || '') === 'string' && /^steam[-_]/i.test(hints.id || '') ? String(hints.id).replace(/^steam[-_]/i, '') : null);
            if (steamId) {
                const cleanSteamId = String(steamId).replace(/^steam[-_]/i, '');
                console.log(`[get-game-metadata] trying platform/id lookup: steam/${cleanSteamId}`);
                try {
                    const hit = await baddelApi.lookupGame({ platform: 'steam', id: cleanSteamId });
                    if (hit) {
                        console.log(`[get-game-metadata] platform/id hit: steam/${cleanSteamId}`);
                        return baddelApi.normalizeServerData(hit);
                    }
                    console.log(`[get-game-metadata] platform/id miss: steam/${cleanSteamId}`);
                } catch (_e) { /* continue to MRM */ }
            }
        }

        // ── Non-Steam/Epic: route through unified MetadataResolutionManager ──────
        // (Riot, EA, Ubisoft, Xbox, Manual, etc.)
        // MRM deduplicates inflight calls, enforces cooldown / not_found / ambiguous
        // state, and persists outcomes across restarts — preventing retry storms.
        const mrm = require('./gameScanner').resolutionManager;

        const _toSlug = str => (str || '')
            .toLowerCase().trim()
            .replace(/['''ʼ＇'`™®©]/g, '').replace(/[^a-z0-9\s\-]/g, ' ')
            .replace(/\s+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');

        // hints.id is the game's internal DB id (MD5) for non-Steam/Epic entries.
        // Fall back to an anonymous key if somehow absent.
        const gameId  = hints.id || null;
        const mrmKey  = gameId || `anon:${_toSlug(originalGameName)}`;

        const forceMetadata =
            hints.force      === true ||
            hints.bypassTtl  === true ||
            hints.ignoreTtl  === true ||
            hints.source === 'manual-add-readd' ||
            hints.source === 'manual-add';

        // Gate on terminal / cooldown MRM states before any network calls.
        if (mrm) {
            const mrmStatus = mrm.getStatus(mrmKey);
            if (!forceMetadata && mrmStatus === 'cooldown') {
                const job = mrm.getJob(mrmKey);
                console.log(`[get-game-metadata] MRM cooldown for "${originalGameName}" until ${new Date(job?.cooldownUntil).toISOString()}`);
                return { _mrmStatus: 'cooldown', _cooldownUntil: job?.cooldownUntil };
            }
            // NOTE: NOT_FOUND / AMBIGUOUS are NOT blocked here — MRM.resolve() itself
            // will detect whether the candidate signature has changed and retry if so.
        }

        // Build MRM candidates using the centralized generator so camelCase splitting
        // and franchise alias expansion (e.g. ACMirage → Assassin's Creed Mirage) apply.
        const rawPathHint = hints.pathHint || hints.path || hints.command || null;
        const mrmCandidates = generateMetadataCandidates({
            name:       originalGameName,
            exeName:    hints.exeName    || undefined,
            folderName: hints.folderName || undefined,
            pathHint:   rawPathHint      || undefined,
        });

        const slug = (mrmCandidates[0]?.slug) || (originalGameName || '')
            .toLowerCase().trim()
            .replace(/['''ʼ＇'`™®©]/g, '').replace(/[^a-z0-9\s\-]/g, ' ')
            .replace(/\s+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');

        if (mrm) {
            console.log(`[get-game-metadata] MRM candidates for "${originalGameName}": ${mrmCandidates.map(c => c.title || c.slug).join(', ')}`);
            console.log(`[get-game-metadata] candidate aliases: ${mrmCandidates.map(c => `${c.title || ''}${c.slug ? ` (${c.slug})` : ''}`).join(' | ')}`);
            console.log(`[get-game-metadata] Routing "${originalGameName}" through MRM (key=${mrmKey})`);
            const resolveResult = await mrm.resolve(mrmKey, {
                candidates:   mrmCandidates,
                title:        originalGameName,
                slug:         (slug && slug.length >= 3) ? slug : undefined,
                platformHint: _mapPlatformHint(hints.platform) || undefined,
                exeName:      hints.exeName    || undefined,
                folderName:   hints.folderName || undefined,
                pathHint:     rawPathHint      || undefined,
                force:        forceMetadata    || undefined,
                bypassTtl:    forceMetadata    || undefined,
            });
            if (resolveResult) {
                resolveResult.meta._resolveSource = resolveResult._resolveSource;
                return resolveResult.meta;
            }
            return null;
        }

        // Fallback if MRM is not available (should not happen in production)
        return null;
    } catch (err) {
        console.warn('[get-game-metadata] Error:', err.message);
        return null;
    }
});

// ── Achievement IPC (moved to handlers/achievementHandlers.js) ───────────
require('./handlers/achievementHandlers').register(ipcMain, {
    _extractSteamAppId,
    _enqueueAchievementFetch,
    _fetchAchievementsForApp,
});

    // ---- Collections (moved to handlers/collectionHandlers.js) ----
    require('./handlers/collectionHandlers').register(ipcMain, { colHandler, analytics });

    // ── Baddel Server IPC (moved to handlers/baddelApiHandlers.js) ───────────
    require('./handlers/baddelApiHandlers').register(ipcMain, { baddelApi });

    createWindow();
    createTray();
    registerAccountHandlers(ipcMain);
    registerPlatformSyncHandlers(ipcMain, () => mainWindow);

    // ── Account Shortcuts IPC (moved to handlers/accountShortcutHandlers.js) ──
    require('./handlers/accountShortcutHandlers').register(ipcMain, { accountShortcuts });

    // Register global shortcuts — fires switchAccountByPlatform and shows a notification.
    await accountShortcuts.registerAll(async (platform, accountId, accountName) => {
        try {
            new Notification({ title: 'Baddel', body: `Switching to ${accountName}…` }).show();
        } catch {}
        return switchAccountByPlatform(platform, accountId);
    });

    // ── Quick Switcher IPC (moved to handlers/quickSwitcherHandlers.js) ───────
    require('./handlers/quickSwitcherHandlers').register(ipcMain, {
        quickSwitcher, quickSwitcherSettings, accountShortcuts,
        ipcValidation, switchAccountByPlatform, analytics,
    });

    // Register the global hotkey and open the overlay on fire.
    try {
        await quickSwitcher.registerQuickSwitcherHotkey();
        try { analytics.track('quick_switcher_opened'); } catch {}
    } catch {}
    quickSwitcher.createQuickSwitcherWindow();

    // ── Wire up background metadata pipeline dependencies ──────────────────
    // The local metadata resolver is kept for compatibility but is a no-op.
    // All non-Steam/Epic resolution now flows through MetadataResolutionManager
    // (mrm.resolve()) in both runBackgroundMetadataPipeline and get-game-metadata.
    const gameScanner = require('./gameScanner');

    gameScanner.registerLocalMetadataResolver(async (gameName, hints = {}) => {
        try {
            const platform = (hints.platform || '').toLowerCase().trim();
            // Steam/Epic are handled by the server enrich pipeline — skip here.
            if (platform === 'steam' || platform === 'epic' || platform === 'epic games') {
                return null;
            }
            // Non-Steam/Epic resolution is owned by MRM.  Return null so nothing
            // double-resolves via this legacy path.
            return null;
        } catch (err) {
            console.warn('[LocalMetaResolver] error:', err.message);
            return null;
        }
    });

    const _downloadAssetsToCache = async (assets, gameId) => {
        if (!CACHE_DIR) return assets;
        const results = {};
        await Promise.all(Object.entries(assets).map(async ([type, url]) => {
            if (!url) return;
            try {
                const baseName = imageWebpCache.cacheBaseName(type, gameId);
                const localPath = await imageWebpCache.downloadToCacheAsWebp(CACHE_DIR, baseName, url);
                results[type] = localPath ? imageWebpCache.filePathToFileUrl(localPath) : url;
            } catch (e) {
                results[type] = url;
            }
        }));
        return results;
    };

    // Wire the same downloader into both pipelines so Steam/Epic games from
    // applyNormalizedToCache also get hero/logo written to image_cache.
    gameScanner.registerImageDownloader(_downloadAssetsToCache);
    registerPlatformSyncAssetDownloader(_downloadAssetsToCache);

    console.log('[Startup] Background metadata pipeline dependencies registered.');

    // Analytics startup snapshot
    try {
        const [games, collections] = await Promise.all([
            require('./gameScanner').getSavedGames(),
            colHandler.getCollections(),
        ]);
        const platforms = [...new Set(games.map(g => g.platform).filter(Boolean))];
        analytics.logAppLaunched({
            platformsConnected:  platforms,
            librarySize:         games.length,
            collectionsCount:    collections.length,
        }).catch(() => {});
    } catch { /* analytics must never crash startup */ }
});

// ============================================================
// STARTUP PREFERENCE HELPERS
// ============================================================
const STARTUP_PREF_FILE = path.join(app.getPath('userData'), 'startup-preferences.json');

function readStartupPrefs() {
    try {
        return JSON.parse(fsSync.readFileSync(STARTUP_PREF_FILE, 'utf8'));
    } catch {
        return {};
    }
}

function writeStartupPrefs(prefs) {
    try {
        fsSync.writeFileSync(STARTUP_PREF_FILE, JSON.stringify(prefs, null, 2), 'utf8');
    } catch (err) {
        console.warn('[Startup] Failed to write startup preferences:', err?.message || err);
    }
}

function getStartupExePath() {
    return process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
}

// Returns the exact identity used for both setLoginItemSettings and getLoginItemSettings.
// On Windows, path+args together identify the registry entry — both calls must use the same values.
function getStartupLoginItemOptions() {
    return { path: getStartupExePath(), args: ['--hidden', '--startup'] };
}

function applyStartupSetting(enabled, reason = 'unknown') {
    if (!app.isPackaged) return false;

    const opts = getStartupLoginItemOptions();
    app.setLoginItemSettings({ openAtLogin: !!enabled, ...opts });

    console.log(`[Startup] openAtLogin=${!!enabled} reason=${reason} path=${opts.path}`);
    return true;
}

// Delays heavy boot tasks when launched at Windows startup so services/network
// are ready before we hit the disk, registry, or network.
function runAfterStartupGrace(label, fn, delayMs = 45000) {
    if (!isStartupLaunch) {
        return fn();
    }

    console.log(`[Startup] delaying ${label} by ${delayMs}ms`);
    setTimeout(() => {
        Promise.resolve()
            .then(fn)
            .catch(err => console.warn(`[Startup] delayed task failed: ${label}`, err?.message || err));
    }, delayMs);
}

// ============================================================
// WINDOWS INTEGRATION (STARTUP + SHORTCUTS)
// ============================================================
function setupWindowsIntegration() {
    if (!app.isPackaged) return;
    const exePath = getStartupExePath();

    // Create Start Menu shortcut
    const shortcutPath = path.join(
        app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Baddel Launcher.lnk'
    );
    try {
        shell.writeShortcutLink(shortcutPath, {
            target: exePath,
            cwd: path.dirname(exePath),
            description: 'The AI Powered Gaming Hub',
            icon: exePath,
            appUserModelId: 'com.baddel.launcher.beta'
        });
    } catch (err) {
        console.error('[Startup] Failed to create shortcuts:', err);
    }

    // Apply startup setting: respect explicit user preference; default to enabled on first run.
    const prefs = readStartupPrefs();
    if (prefs.userSetStartupEnabled === true) {
        // User has explicitly toggled — honour their choice unconditionally.
        applyStartupSetting(!!prefs.startupEnabled, 'user-preference');
    } else {
        // No explicit user preference yet → enable startup by default.
        applyStartupSetting(true, 'default-first-run');
        writeStartupPrefs({
            ...prefs,
            startupEnabled: true,
            userSetStartupEnabled: false,
            defaultAppliedAt: prefs.defaultAppliedAt || new Date().toISOString(),
        });
    }

    // Log current Windows login-item state for diagnostics (must use same options as set)
    try {
        console.log('[Startup] loginItemSettings:', app.getLoginItemSettings(getStartupLoginItemOptions()));
    } catch {}
}

// ---- System handlers (get-drives, list-directories, get-desktop-path, get-system-info, get-live-stats, get-startup-enabled, set-startup-enabled) ----
require('./handlers/systemHandlers').register(ipcMain, {
    app, os, path, fs, shell,
    driveCache, refreshDriveCache,
    readStartupPrefs, writeStartupPrefs, getStartupLoginItemOptions, applyStartupSetting,
});


// ============================================================
// PLATFORM DETECTION HELPER
// ============================================================
function _detectPlatform(command) {
    if (!command) return 'unknown';
    const cmd = command.toLowerCase();
    
    if (cmd.includes('steam://')) return 'steam';
    if (cmd.includes('com.epicgames')) return 'epic';
    if (cmd.includes('riotclientservices') || cmd.includes('valorant') || cmd.includes('leagueclient')) return 'riot';
    if (cmd.includes('eadesktop://') || cmd.includes('origin2://')) return 'ea'; 
    if (cmd.includes('uplay://') || cmd.includes('ubisoftconnect://')) return 'ubisoft';
    if (cmd.includes('xbox://') || cmd.includes('ms-xbl') || cmd.includes('shell:appsfolder')) return 'xbox'; 
    
    return 'manual';
}

// ============================================================
// APP LIFECYCLE
// ============================================================
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

app.on('before-quit', () => {
    isQuitting = true;
    analytics.stopHeartbeat();
    accountShortcuts.unregisterAll();
    quickSwitcher.unregisterQuickSwitcherHotkey();
    quickSwitcher.destroyQuickSwitcherWindow();
    // Save in-progress playtime sessions before exit
    for (const [gameId, tracker] of Object.entries(activeTrackers)) {
        clearInterval(tracker.intervalId);
        const game = getTrackingGame(gameId);
        _flushActiveTime(tracker, Date.now());
        saveTrackerPlaytime(gameId, tracker, game?.name || '');
    }
    osHelper.shutdown();
});

// ---- External-link handlers (open-external-url, open-community-url — moved to handlers/externalLinkHandlers.js) ----
require('./handlers/externalLinkHandlers').register(ipcMain, { shell, ipcValidation, safeLauncher });

// ── Update notes IPC (moved to handlers/updateNotesHandlers.js) ──────────────
require('./handlers/updateNotesHandlers').register(ipcMain, { getPendingUpdateNotesPayload, markUpdateNotesShown, app });

// ── Reliable install opener with cold-start retry ────────────────────────────
const _installInFlight = new Set();

function _getInstallLogFile() {
    return path.join(app.getPath('userData'), 'logs', 'install-opener.log');
}

function _installLog(level, message, data = null) {
    const line = JSON.stringify({
        ts: new Date().toISOString(),
        level,
        message,
        data,
    }) + '\n';

    try {
        const file = _getInstallLogFile();
        fsSync.mkdirSync(path.dirname(file), { recursive: true });
        fsSync.appendFileSync(file, line, 'utf8');
    } catch (e) {
        console.warn('[InstallOpener][LogFile] failed:', e.message);
    }

    const fn = level === 'error'
        ? console.error
        : level === 'warn'
            ? console.warn
            : console.log;

    fn(`[InstallOpener] ${message}`, data || '');
}

async function _openProtocolUrlReliable(url, reason = 'unknown') {
    const results = [];

    _installLog('info', 'Opening protocol URL', { reason, url });

    try {
        await shell.openExternal(url);
        results.push({ method: 'shell.openExternal', ok: true });
        _installLog('info', 'Protocol open results', { reason, url, results });
        return results;
    } catch (e) {
        results.push({ method: 'shell.openExternal', ok: false, error: e.message });
    }

    try {
        await safeLauncher.openProtocolUrl(url);
        results.push({ method: 'cmd.start', ok: true });
        _installLog('info', 'Protocol open results', { reason, url, results });
        return results;
    } catch (e) {
        results.push({ method: 'cmd.start', ok: false, error: e.message });
    }

    _installLog('error', 'Protocol open failed', { reason, url, results });
    throw new Error(`Failed to open protocol URL: ${url}`);
}

async function _launcherIsRunning(names) {
    try {
        const { default: psListFn } = await import('ps-list');
        const processes = await psListFn();
        const lowerNames = names.map(n => n.toLowerCase());
        return processes.some(p => lowerNames.includes((p.name || '').toLowerCase()));
    } catch (e) {
        console.warn('[InstallOpener] psList failed:', e.message);
        return false;
    }
}

async function _waitForLauncherProcess(names, timeoutMs = 20000, pollMs = 1000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await _launcherIsRunning(names)) return true;
        await new Promise(r => setTimeout(r, pollMs));
    }
    return false;
}


async function _waitForEpicReady(timeoutMs = 90000, pollMs = 1500) {
    const deadline = Date.now() + timeoutMs;
    let stableSince = null;
    let lastSnapshot = null;

    while (Date.now() < deadline) {
        try {
            const { default: psListFn } = await import('ps-list');
            const processes = await psListFn();
            const names = processes.map(p => String(p.name || '').toLowerCase());

            const hasLauncher = names.includes('epicgameslauncher.exe');
            const hasWebHelper = names.includes('epicwebhelper.exe');

            lastSnapshot = { hasLauncher, hasWebHelper };

            if (hasLauncher && hasWebHelper) {
                if (!stableSince) {
                    stableSince = Date.now();
                    _installLog('info', 'Epic launcher + webhelper detected; waiting stable window', lastSnapshot);
                }

                if (Date.now() - stableSince >= 5000) {
                    _installLog('info', 'Epic appears ready', lastSnapshot);
                    return true;
                }
            } else {
                stableSince = null;
            }
        } catch (e) {
            _installLog('warn', 'Epic readiness check failed', { error: e.message });
        }

        await new Promise(r => setTimeout(r, pollMs));
    }

    _installLog('warn', 'Epic readiness timeout; continuing anyway', lastSnapshot);
    return false;
}

const COLD_START_GRACE_MS    = 2000;
const ACCOUNT_SWITCH_GRACE_MS = 6000;

const EPIC_WARM_RETRY_DELAYS_MS = [2000];

// ── Epic UI stability polling (replaces fixed-delay cold-start wait) ──────────
async function _waitForEpicUiStable(options = {}) {
    const timeoutMs           = options.timeoutMs           || 90000;
    const pollMs              = options.pollMs              || 250;
    const minWebHelpers       = options.minWebHelpers       || 5;
    const requiredStableTicks = options.requiredStableTicks || 8;

    const deadline   = Date.now() + timeoutMs;
    let stableTicks  = 0;
    let lastSig      = '';

    _installLog('info', '[EpicUiStable] Polling started', { timeoutMs, pollMs, minWebHelpers, requiredStableTicks });

    while (Date.now() < deadline) {
        try {
            const { default: psListFn } = await import('ps-list');
            const processes = await psListFn();

            const launcher = processes.find(p => (p.name || '').toLowerCase() === 'epicgameslauncher.exe');
            const helpers  = processes.filter(p => (p.name || '').toLowerCase() === 'epicwebhelper.exe');

            const launcherPid  = launcher ? launcher.pid : null;
            const helperCount  = helpers.length;
            const helperPids   = helpers.map(p => p.pid).sort((a, b) => a - b);

            if (launcherPid && helperCount >= minWebHelpers) {
                const sig = `${launcherPid}-${helperCount}-${helperPids.join(',')}`;

                if (sig === lastSig) {
                    stableTicks++;
                } else {
                    stableTicks = 0;
                    lastSig     = sig;
                    _installLog('info', '[EpicUiStable] Signature changed; resetting stable ticks', { sig, helperCount });
                }

                if (stableTicks >= requiredStableTicks) {
                    _installLog('info', '[EpicUiStable] Stable! Returning true', { sig, stableTicks });
                    return true;
                }
            } else {
                // Not ready yet — reset stable counter
                if (stableTicks > 0 || lastSig) {
                    stableTicks = 0;
                    lastSig     = '';
                }
            }
        } catch (e) {
            _installLog('warn', '[EpicUiStable] ps-list error', { error: e.message });
        }

        await new Promise(r => setTimeout(r, pollMs));
    }

    _installLog('warn', '[EpicUiStable] Timed out waiting for Epic UI stability');
    return false;
}

// ── Normalize Epic install URL to AppName-based form ─────────────────────────
// Converts old tuple URLs:
//   com.epicgames.launcher://apps/<namespace>%3A<catalogItemId>%3A<appName>?action=install&silent=false
// to the reliable AppName-only form:
//   com.epicgames.launcher://apps/<appName>?action=install&silent=false
function _normalizeEpicInstallUrl(url) {
    try {
        // Extract the /apps/<token> portion
        const appsMatch = url.match(/^com\.epicgames\.launcher:\/\/apps\/([^?]+)/i);
        if (!appsMatch) return url; // not an apps URL — return unchanged

        const rawToken   = appsMatch[1];
        const decoded    = decodeURIComponent(rawToken);

        // Tuple format: namespace:catalogItemId:appName
        const parts = decoded.split(':');
        const appName = parts.length === 3 ? parts[2].trim() : decoded.trim();

        if (!appName) return url;

        return `com.epicgames.launcher://apps/${encodeURIComponent(appName)}?action=install&silent=false`;
    } catch (e) {
        _installLog('warn', '[EpicInstall] URL normalization error', { url, error: e.message });
        return url;
    }
}

// ── Epic cold-start install dispatcher ───────────────────────────────────────
async function _openEpicInstallUrlWithColdStartRecovery(installUrl, wasRunning) {
    _installLog('info', '[EpicInstall] first dispatch', { installUrl, wasRunning });

    const firstReason = wasRunning ? 'epic-install-warm' : 'epic-install-cold-wake';
    await _openProtocolUrlReliable(installUrl, firstReason);
    let attempts = 1;

    let epicReady = true; // warm path: assume ready

    if (!wasRunning) {
        // Cold start: first dispatch just wakes Epic. Wait for UI stability then re-send.
        _installLog('info', '[EpicInstall] Cold start — waiting for Epic UI stability before second dispatch');
        epicReady = await _waitForEpicUiStable();
        _installLog('info', '[EpicInstall] _waitForEpicUiStable returned', { epicReady });

        await _openProtocolUrlReliable(installUrl, 'epic-install-cold-after-ready');
        attempts++;
        _installLog('info', '[EpicInstall] Second dispatch sent', { attempt: attempts, installUrl });
    }

    return { attempts, coldStartRecoveryUsed: !wasRunning, epicReady };
}

// ── Epic launch URL normalizer (play) ─────────────────────────────────────────
// Converts old tuple launch URLs:
//   com.epicgames.launcher://apps/<namespace>%3A<catalogItemId>%3A<appName>?action=launch...
// to the AppName-only form:
//   com.epicgames.launcher://apps/<appName>?action=launch&silent=true
function normalizeEpicLaunchUrl(url) {
    try {
        const appsMatch = url.match(/^com\.epicgames\.launcher:\/\/apps\/([^?]+)/i);
        if (!appsMatch) return url;

        const rawToken = appsMatch[1];
        const decoded  = decodeURIComponent(rawToken);

        // Tuple format: namespace:catalogItemId:appName
        const parts   = decoded.split(':');
        const appName = parts.length === 3 ? parts[2].trim() : decoded.trim();

        if (!appName) return url;

        return `com.epicgames.launcher://apps/${encodeURIComponent(appName)}?action=launch&silent=true`;
    } catch (e) {
        console.warn('[EpicPlay] URL normalization error', { url, error: e.message });
        return url;
    }
}

// ── Epic play cold-start dispatcher ──────────────────────────────────────────
async function _openEpicPlayUrlWithColdStartRecovery(playUrl, wasRunning) {
    const finalUrl = normalizeEpicLaunchUrl(playUrl);

    console.log('[EpicPlay] first dispatch', {
        wasRunning,
        original: playUrl,
        final:    finalUrl,
    });

    await _openProtocolUrlReliable(finalUrl, wasRunning ? 'epic-play-warm' : 'epic-play-cold-wake');

    let attempts  = 1;
    let epicReady = null;

    if (!wasRunning) {
        epicReady = await _waitForEpicUiStable({
            timeoutMs:           90000,
            pollMs:              250,
            minWebHelpers:       5,
            requiredStableTicks: 8,
        });

        console.log('[EpicPlay] second dispatch after readiness', { epicReady, final: finalUrl });

        await _openProtocolUrlReliable(finalUrl, 'epic-play-cold-after-ready');
        attempts++;
    }

    return { finalUrl, attempts, coldStartRecoveryUsed: !wasRunning, epicReady };
}

function _pathExists(p) {
    try {
        return !!p && fsSync.existsSync(p);
    } catch {
        return false;
    }
}

function _expandEnvVars(value) {
    return String(value || '').replace(/%([^%]+)%/g, (_, key) => {
        return process.env[key] || process.env[key.toUpperCase()] || '';
    });
}

async function _regQueryValue(key, valueName = null) {
    try {
        const args = valueName ? ['query', key, '/v', valueName] : ['query', key, '/ve'];
        const { execFile: _ef } = require('child_process');
        const { promisify: _pf } = require('util');
        const { stdout } = await _pf(_ef)('reg.exe', args);
        const line = stdout
            .split(/\r?\n/)
            .map(x => x.trim())
            .find(x => /\sREG_\w+\s/i.test(x));

        if (!line) return null;

        const match = line.match(/\sREG_\w+\s+(.+)$/i);
        return match?.[1]?.trim() || null;
    } catch {
        return null;
    }
}

function _extractExePathFromCommand(command) {
    if (!command) return null;

    const expanded = _expandEnvVars(command);

    const quoted = expanded.match(/"([^"]+\.exe)"/i);
    if (quoted?.[1]) return quoted[1];

    const unquoted = expanded.match(/([a-zA-Z]:\\[^\s"]+\.exe)/i);
    if (unquoted?.[1]) return unquoted[1];

    return null;
}

async function _getProtocolHandlerExe(protocolName) {
    const command = await _regQueryValue(`HKCR\\${protocolName}\\shell\\open\\command`);
    const exe = _extractExePathFromCommand(command);
    return _pathExists(exe) ? exe : null;
}

async function _resolveSteamExe() {
    const protocolExe = await _getProtocolHandlerExe('steam');
    if (protocolExe) return protocolExe;

    const regPath =
        await _regQueryValue('HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath') ||
        await _regQueryValue('HKCU\\Software\\Valve\\Steam', 'SteamPath');

    const candidates = [
        regPath ? path.join(regPath, 'steam.exe') : null,
        'C:\\Program Files (x86)\\Steam\\steam.exe',
        'C:\\Program Files\\Steam\\steam.exe',
    ];

    return candidates.find(_pathExists) || null;
}

async function _resolveEpicExe() {
    const protocolExe = await _getProtocolHandlerExe('com.epicgames.launcher');
    if (protocolExe) return protocolExe;

    const candidates = [
        path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Epic Games', 'Launcher', 'Portal', 'Binaries', 'Win64', 'EpicGamesLauncher.exe'),
        path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Epic Games', 'Launcher', 'Portal', 'Binaries', 'Win64', 'EpicGamesLauncher.exe'),
    ];

    return candidates.find(_pathExists) || null;
}

async function _getExternalLauncherInfo(platform) {
    const config = {
        steam: {
            name: 'Steam',
            resolver: _resolveSteamExe,
        },
        epic: {
            name: 'Epic Games Launcher',
            resolver: _resolveEpicExe,
        },
    }[platform];

    if (!config) {
        return {
            available: false,
            code: 'UNSUPPORTED_PLATFORM',
            message: `Unsupported platform: ${platform}`,
        };
    }

    const exe = await config.resolver();

    if (!exe) {
        return {
            available: false,
            code: 'LAUNCHER_NOT_INSTALLED',
            platform,
            message: `${config.name} is not installed. Please install ${config.name} first, then try again.`,
        };
    }

    return {
        available: true,
        platform,
        name: config.name,
        exe,
    };
}

ipcMain.handle('launcher:open-install-url', async (event, payload) => {
    const {
        platform,
        installUrl,
        retryOnColdStart    = true,
        forceRetryAfterOpen = false,
        fallbackToStore     = true,   // Steam: open store page after install attempts
    } = payload || {};

    const ALLOWED_PLATFORMS = ['steam', 'epic'];
    const PROTOCOL_MAP = {
        epic:  'com.epicgames.launcher://',
        steam: 'steam://',
    };
    const PROCESS_NAMES = {
        epic:  ['epicgameslauncher.exe'],
        steam: ['steam.exe', 'steamwebhelper.exe'],
    };

    if (!ALLOWED_PLATFORMS.includes(platform)) {
        return { ok: false, error: `Unsupported platform: ${platform}`, platform, installUrl };
    }
    if (!installUrl || !installUrl.startsWith(PROTOCOL_MAP[platform])) {
        return { ok: false, error: `Invalid install URL for ${platform}: ${installUrl}`, platform, installUrl };
    }

    const launcherInfo = await _getExternalLauncherInfo(platform);

    if (!launcherInfo.available) {
        return {
            ok: false,
            code: launcherInfo.code,
            platform,
            installUrl,
            message: launcherInfo.message,
            error: launcherInfo.message,
        };
    }

    // For Epic: normalize the install URL to AppName-based form before everything else
    const originalInstallUrl = installUrl;
    const effectiveInstallUrl = platform === 'epic'
        ? _normalizeEpicInstallUrl(installUrl)
        : installUrl;

    if (platform === 'epic' && effectiveInstallUrl !== originalInstallUrl) {
        _installLog('info', '[EpicInstall] URL normalized', { originalInstallUrl, effectiveInstallUrl });
    }

    const key = `${platform}:${effectiveInstallUrl}`;
    if (_installInFlight.has(key)) {
        console.log(`[InstallOpener] Already in-flight, ignoring duplicate: ${key}`);
        return { ok: true, platform, installUrl: effectiveInstallUrl, attempts: 0, coldStartRetryUsed: false };
    }
    _installInFlight.add(key);

    // Extract appid for Steam fallback and result reporting
    const appid = platform === 'steam'
        ? (effectiveInstallUrl.match(/^steam:\/\/install\/(\d+)/) || [])[1] || null
        : null;

    let attempts = 0;
    let coldStartRetryUsed = false;
    let fallbackStoreUsed  = false;
    try {
        const names = PROCESS_NAMES[platform];
        const wasRunning = await _launcherIsRunning(names);

        if (platform === 'steam') {
            console.log(`[InstallOpener] steam payload`, { appid, installUrl: effectiveInstallUrl, wasRunning, forceRetryAfterOpen, fallbackToStore });
        } else {
            console.log(`[InstallOpener] ${platform} wasRunning=${wasRunning} forceRetryAfterOpen=${forceRetryAfterOpen} url=${effectiveInstallUrl}`);
        }

        // Attempt flow
        if (platform === 'epic') {
            _installLog('info', '[EpicInstall] Starting Epic install dispatch flow', {
                originalInstallUrl,
                normalizedInstallUrl: effectiveInstallUrl,
                wasRunning,
            });

            const result = await _openEpicInstallUrlWithColdStartRecovery(effectiveInstallUrl, wasRunning);
            attempts += result.attempts;
            coldStartRetryUsed = !!result.coldStartRecoveryUsed;

            _installLog('info', 'Epic install completed dispatch flow', {
                installUrl: effectiveInstallUrl,
                wasRunning,
                attempts,
                coldStartRetryUsed,
                epicReady: result.epicReady,
            });
        } else {
            // Steam (and any future non-Epic) branch — unchanged
            try {
                await _openProtocolUrlReliable(effectiveInstallUrl, `${platform}-warm-attempt-1`);
            } catch (shellErr) {
                if (/^(steam|com\.epicgames\.launcher):\/\//.test(effectiveInstallUrl)) {
                    console.warn(`[InstallOpener] shell.openExternal failed, trying start "" fallback:`, shellErr.message);
                    await safeLauncher.openProtocolUrl(effectiveInstallUrl);
                } else {
                    throw shellErr;
                }
            }

            attempts++;
            console.log(`[InstallOpener] opening install-url attempt 1 (${effectiveInstallUrl})`);

            const needsRetry = (!wasRunning && retryOnColdStart) || forceRetryAfterOpen;

            if (needsRetry) {
                const retryReason = !wasRunning ? 'cold_start' : 'launcher_ready_retry';

                console.log(
                    `[InstallOpener] Retry reason: ${retryReason} — waiting for ${names.join('/')} to become ready`
                );

                const appeared = wasRunning
                    ? true
                    : await _waitForLauncherProcess(names, 30000, 1000);

                if (appeared) {
                    const graceMs = forceRetryAfterOpen
                        ? ACCOUNT_SWITCH_GRACE_MS
                        : COLD_START_GRACE_MS;

                    console.log(
                        `[InstallOpener] Launcher present — waiting ${graceMs}ms grace (${retryReason})`
                    );

                    await new Promise(r => setTimeout(r, graceMs));
                    await shell.openExternal(effectiveInstallUrl);

                    attempts++;
                    coldStartRetryUsed = true;

                    console.log(
                        `[InstallOpener] opening install-url attempt 2 (${retryReason})`
                    );
                } else {
                    console.warn(`[InstallOpener] ${platform} launcher did not appear within 30s`);
                }
            }
        }
        // Steam: store-page fallback so user always lands on the correct game page.
        // Fires whenever fallbackToStore=true, regardless of wasRunning/coldStart state,
        // because steam://install/<appid> is frequently ignored by Steam.
        if (platform === 'steam' && appid && fallbackToStore) {
            await new Promise(r => setTimeout(r, 3000));
            const storeUrl = `steam://store/${appid}`;
            console.log(`[InstallOpener] Steam fallback store page: ${storeUrl}`);
            await shell.openExternal(storeUrl);
            fallbackStoreUsed = true;
        }

        return { ok: true, platform, installUrl: effectiveInstallUrl, attempts, coldStartRetryUsed, forceRetryAfterOpen, fallbackStoreUsed, wasRunning, appid };
    } catch (e) {
        console.error(`[InstallOpener] Error:`, e);
        return { ok: false, error: e.message, platform, installUrl: effectiveInstallUrl, appid };
    } finally {
        _installInFlight.delete(key);
    }
});

// ---- Analytics handlers (consent, log events — moved to handlers/analyticsHandlers.js) ----
require('./handlers/analyticsHandlers').register(ipcMain, { analytics, fs, app });

ipcMain.handle('get-app-version', () => app.getVersion());
ipcMain.handle('check-for-updates', async () => {
    if (!autoUpdater) {
        console.warn('[AutoUpdater] checkForUpdates skipped — autoUpdater not initialised');
        return;
    }
    try {
        await autoUpdater.checkForUpdates();
    } catch (err) {
        console.warn('[AutoUpdater] Manual check failed:', err.message);
    }
});

// YouTube trailers are now rendered via <webview> tag in the renderer.
// The will-attach-webview + web-contents-created handlers above enforce security.