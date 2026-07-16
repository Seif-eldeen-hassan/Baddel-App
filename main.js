const { app, BrowserWindow, ipcMain, shell, Tray, Menu, dialog, session, protocol, Notification, screen } = require('electron');
let autoUpdater = null; // lazy-loaded inside setupAutoUpdater() - never required at module load
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const os = require('os');
const { exec, spawn } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const { getGamesFeature } = require('./src/features/games/infrastructure/composition/GamesContainer');
const gamesApi = getGamesFeature();
const {
    scanAllGames, addManualGame, getSavedGames, updateGameImage, resetGameImage,
    removeGame, renameGame, unhideAllGames, getHiddenGames,
    restoreSpecificGames, deleteGamePermanently, reorderLibrary,
    updateGameMetadata, saveFullMetadata, loadFullMetadata,
    updatePlaytime, setTimeTrackingEnabled, getTimeTrackingEnabled,
    refetchMissingImages, runBackgroundMetadataPipeline, getJsonGameRepository,
} = gamesApi;
const colHandler      = require('./collectionsHandler');
const baddelApi       = require('./services/baddelApi');
const imageWebpCache  = require('./services/imageWebpCache');
const { generateMetadataCandidates } = require('./services/candidateGenerator');
const { registerAccountHandlers, switchAccountByPlatform } = require('./accountsHandler');
const accountShortcuts = require('./services/accountShortcuts');
const quickSwitcher = require('./services/quickSwitcher');
const quickSwitcherSettings = require('./services/quickSwitcherSettings');
const {
    getSyncFeature,
} = require('./src/features/sync/infrastructure/composition/SyncContainer');
const { registerPlatformSyncHandlers, steamConnector, epicConnector, registerPlatformSyncAssetDownloader, autoSyncOnStartup } = getSyncFeature();
const analytics = require('./analytics');
const steamBridge = require('./steamBridge');
const { fileURLToPath } = require('url');
const safeLauncher  = require('./services/safeLauncher');
const ipcValidation = require('./services/ipcValidation');
const gamesIpc = require('./src/features/games/infrastructure/ipc/games.ipc');

// ── Production build detection ────────────────────────────────────────────────
// Returns true when running from a packaged (installed) build.
// Set BADDEL_ENABLE_DEVTOOLS=1 in the environment to re-enable DevTools even in
// a packaged build (useful for diagnosing release-only issues locally).
function isProductionBuild() {
    return app.isPackaged && process.env.BADDEL_ENABLE_DEVTOOLS !== '1';
}

// Input-event handler attached to every webContents in production to block DevTools shortcuts.
// Blocks Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+Shift+C, and F12.
function _blockDevToolsInput(event, input) {
    const ctrl = input.control || input.meta;
    const key  = input.key.toLowerCase();
    if (
        (ctrl && input.shift && (key === 'i' || key === 'j' || key === 'c')) ||
        input.key === 'F12'
    ) {
        event.preventDefault();
    }
}

// Remove the native application menu in production (hides the DevTools menu item).
if (isProductionBuild()) {
    Menu.setApplicationMenu(null);
}

// One achievement fetch at a time - avoids overlapping authenticate/get_achievements on the single Python bridge.
let _achievementIpcChain = Promise.resolve();
function _enqueueAchievementFetch(fn) {
    const next = _achievementIpcChain.then(fn, fn);
    _achievementIpcChain = next.catch(() => {});
    return next;
}

// ============================================================
// AUTO UPDATER - state machine (initialised inside app.whenReady)
// ============================================================
// Do NOT call autoUpdater.setFeedURL / attach listeners here at module-load
//     time.  electron-updater v6 reads app.getAppPath()/package.json synchronously
//     during initialisation; if the asar is still being replaced right after an
//     NSIS update the file is transiently missing -> "ENOENT package.json" crash
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

// -- Update notes - show once per installed version --

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
        },
        '1.1.4': {
            version:  '1.1.4',
            type:     'feature-tour',
            title:    "What's New in Baddel 1.1.4",
            subtitle: 'A faster way to switch accounts, organize your library, and reach your games.',
            slides: [
                {
                    image:       'assets/update-notes/1.1.4/feature1.png',
                    label:       'Quick Switch Overlay',
                    headline:    'Switch From Anywhere',
                    description: 'Press Ctrl + Alt + B to open your account switcher overlay anywhere — on desktop, in-game, or while using another app.',
                    badge:       'Ctrl + Alt + B',
                    helper:      'Your accounts are now one shortcut away, even when Baddel is not open in front of you.',
                },
                {
                    image:       'assets/update-notes/1.1.4/feature2.png',
                    label:       'Keybind for Every Account',
                    headline:    'Switch Accounts Without Opening Baddel',
                    description: 'Assign a custom shortcut to any account and switch instantly without opening the main Baddel window.',
                    helper:      'Perfect for players who use multiple Steam, Epic, Riot, or other platform accounts.',
                },
                {
                    image:       'assets/update-notes/1.1.4/feature3.png',
                    label:       'Ready to Install Tab',
                    headline:    'Find Uninstalled Games Faster',
                    description: "Games you own but haven't installed yet now have their own dedicated tab, so you can find and install them faster.",
                    helper:      'Rediscover games already in your library without searching through everything.',
                },
                {
                    image:       'assets/update-notes/1.1.4/feature4.png',
                    label:       'Improved Collections',
                    headline:    'Organize Your Library Your Way',
                    description: 'Manage collections from one place, view more details, add games, rename collections, and customize collection covers.',
                    helper:      'Build collections for favorites, backlog, genres, platforms, or any setup you like.',
                },
                {
                    image:       'assets/update-notes/1.1.4/feature5.png',
                    label:       'Smarter Sidebar',
                    headline:    'Everything Important, Closer',
                    description: 'The sidebar has been redesigned to give you faster access to your library, accounts, collections, and important sections.',
                    helper:      'Less digging through menus. More direct access.',
                },
            ],
            footer: 'Thanks for using Baddel — more improvements are on the way.',
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
            console.warn('[AutoUpdater] Stall timeout - no download progress for 120 s');
            _updState.downloading = false;
            _updState.status      = 'error';
            const msg = 'Download stalled. Check your connection and try again.';
            if (mainWindow) mainWindow.webContents.send('update-error', msg);
            _sendUpdateStatus({ status: 'error', message: msg });
        }
    }, 120_000);
}

// Called once from app.whenReady() - safe because app is fully initialised by then.
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

        // -- events --

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

        console.log('[AutoUpdater] Initialised - current version:', app.getVersion());
    } catch (err) {
        // Non-fatal: log but don't crash the app if auto-updater can't initialise
        console.error('[AutoUpdater] Failed to initialise (non-fatal):', err.message);
    }
}

// Image cache grace period — passed as dep into imageHandlers via gamesIpc (Phase 3.3)
const IMAGE_CACHE_PRUNE_GRACE_MS = 24 * 60 * 60 * 1000;

// -- IPC: start download - handle (invoke) so renderer gets immediate feedback --
// -- Auto-Update IPC (moved to handlers/autoUpdateHandlers.js) --
require('./handlers/autoUpdateHandlers').register(ipcMain, {
    _updState,
    getAutoUpdater:          () => autoUpdater,
    getMainWindow:           () => mainWindow,
    setIsQuitting:           (v) => { isQuitting = v; },
    getTray:                 () => tray,
    setTray:                 (v) => { tray = v; },
    getUpdateInstallStarted: () => _updateInstallStarted,
    setUpdateInstallStarted: (v) => { _updateInstallStarted = v; },
    _sendUpdateStatus,
    _clearPrepareTimer,
    _clearAllUpdateTimers,
    readUpdateNotesState,
    markUpdateNotesPending,
});



// ============================================================
// GLOBALS
// ============================================================
let mainWindow;
let tray = null;
let isQuitting = false;

const driveCache = { data: null, lastFetched: 0 };
const DRIVE_CACHE_TTL = 60_000;

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
    // Only show the error dialog when the window is visible - at boot-time
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
// DYNAMIC GAME EXE SCANNER
// ============================================================
const dynamicExeCache = {};

async function getDynamicGameExes(gameId, gamePath) {
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
        
        const items = await fsPromises.readdir(gamePath, { withFileTypes: true });
        
        for (const item of items) {
            if (item.isFile() && item.name.toLowerCase().endsWith('.exe')) {
                exes.add(item.name.toLowerCase());
            } else if (item.isDirectory()) {
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
                    } catch(e) {  }
                }
            }
        }
    } catch(e) {  }
    
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
// DYNAMIC NAME GENERATOR
// ============================================================
function generateDynamicAliases(gameName) {
    if (!gameName) return [];
    const clean = gameName.toLowerCase().replace(/[^a-z0-9\s]/g, '');
    const words = clean.split(/\s+/).filter(w => w.length > 0);
    
    const aliases = new Set();
 // ...: "Rainbow Six Siege" -> "rainbowsixsiege"
    aliases.add(clean.replace(/\s+/g, '')); 
    
    // slug form: "rainbow-six-siege"
    const slug = clean.replace(/\s+/g, '-').replace(/-{2,}/g, '-');
    if (slug) aliases.add(slug);

    if (words.length > 1) {
 // ...: "Rainbow Six Siege" -> "rss"
        aliases.add(words.map(w => w[0]).join('')); 
 // ...: "Assassins Creed Valhalla" -> "acvalhalla"
        if (words[0] === 'assassins' && words[1] === 'creed') {
            aliases.add('ac' + words.slice(2).join('')); 
            aliases.add('ac ' + words.slice(2).join(' '));
            aliases.add('ac-' + words.slice(2).join('-'));
        }
    }
    return [...aliases].filter(a => a && a.length >= 3);
}

const osHelper = require('./playtimeOsHelper');

// -- Tracking constants --
const TRACK_INTERVAL_MS      = 10_000;
const LAUNCH_TIMEOUT_MS      = 5 * 60_000;   // give up after 5 min if process never appears
const GRACE_PERIOD_MS        = 90_000;        // alt-tab grace before entering paused_bg
const IDLE_THRESHOLD_MS      = 5 * 60_000;   // 5 min idle -> paused_idle
const SUSPICIOUS_MIN_RAW_MS  = 60 * 60_000;  // 1 h raw runtime before suspicious check
const SUSPICIOUS_MAX_RATIO   = 0.05;         // <5 % active -> suspicious
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

        const gameExes = await getDynamicGameExes(gameId, pathLower);

        for (const p of processes) {
            const pName = p.name.toLowerCase();
            const pCmd = (p.cmd || '').toLowerCase();
            const cleanProcessName = pName.replace('.exe', '').replace(/[^a-z0-9]/g, '');

            if (explicitExes.includes(pName)) return true;
            if (explicitPathHints.some(hint => pCmd.includes(hint))) return true;

            if (ignoredExes.includes(pName)) continue;

            if (gameExes.includes(pName)) return true;

            // 2. Riot Games - Win10 compatible detection
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

            if (pathLower && pathLower.length > 5 && pCmd.includes(pathLower)) return true;

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
        .replace(/[\u2122\u00ae\u00a9]/g, '')
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

// -- Foreground helper --
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

// -- State machine tick --
async function _tickTracker(gameId, command, gamePath, gameName) {
    const tracker = activeTrackers[gameId];
    if (!tracker) return;

    tracker.checkCount++;
    const isDebugTick = tracker.checkCount <= 4 && tracker.state === 'launching';
    const isRunning   = await isGameRunning(command, gamePath, gameName, gameId, isDebugTick);
    const now         = Date.now();

    // -- Process gone -> end --
    if (!isRunning) {
        if (tracker.state === 'launching' && now - tracker.clickTime < LAUNCH_TIMEOUT_MS) return;
        _endTrackerSession(gameId, tracker, gameName, 'process_gone');
        return;
    }

    // -- First process detection --
    if (!tracker.sessionStartTime) {
        tracker.sessionStartTime = now;
        tracker.state = 'detected';
        console.log(`[Playtime] session detected: ${gameName}`);
    }
    tracker.totalRawMs = now - tracker.sessionStartTime;

    // -- Foreground + idle checks --
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

    // -- OS helper unavailable: split policy by session origin --
    // User-explicitly-launched sessions get legacy counting (effectiveFg=true,
    // confidence upgraded to 'legacy'). External/watcher sessions stay in
    // 'detected' state - they must not qualify without actual FG confirmation.
    let effectiveFg;
    if (!osAvailable) {
        if (tracker.userLaunched) {
            effectiveFg = true;
            if (!tracker._osHelperWarnedOnce) {
                console.log(`[Playtime] OS helper unavailable - legacy counting for user-launched: ${gameName}`);
                tracker._osHelperWarnedOnce = true;
                tracker.confidence = 'legacy';
            }
        } else {
            effectiveFg = false;
            if (!tracker._osHelperWarnedOnce) {
                console.log(`[Playtime] OS helper unavailable - external session stays unconfirmed (won't qualify): ${gameName}`);
                tracker._osHelperWarnedOnce = true;
            }
        }
    } else {
        // OS helper available: only match if explicitly confirmed as game foreground
        effectiveFg = isFg === true;
    }

    // -- State transitions --
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
            // Still active - accumulate
            tracker.foregroundSeen = true;
            _doPeriodicSave(gameId, tracker);
        }
    }

    // -- Grace period accounting for paused_bg --
    if (tracker.state === 'paused_bg') {
        if (effectiveFg && !isIdle) {
            // Came back - resume active
            tracker.state        = 'active';
            tracker.activeStartTime = now;
            tracker.foregroundSeen  = true;
            console.log(`[Playtime] foreground active: ${gameName}`);
            if (tracker.bgStartTime) {
                tracker.backgroundMs += now - tracker.bgStartTime;
                tracker.bgStartTime   = null;
            }
        } else if (now > tracker.graceEndTime && tracker.bgStartTime) {
            // Grace expired - account background time and reset
            tracker.backgroundMs += now - tracker.bgStartTime;
            tracker.bgStartTime   = now;
        }
    }

    // -- Idle time accounting --
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

    // -- Suspicious detection --
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
    gamesApi.updatePlaytime(gameId, mins).catch((err) => {
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
                    console.log(`[Playtime] external launch detected: ${game.name} (confidence=${matchedConf}) - OS helper required for session to qualify`);
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

    // Guard: ensure the export is wired up correctly (catches future regressions early)
    if (typeof gamesApi.saveQualifiedSession !== 'function') {
        console.error('[Playtime] saveQualifiedSession is not a function on gamesApi - skipping save for:', gameName);
        return;
    }

    console.log(`[Playtime] saveTrackerPlaytime -> gameId=${gameId} gameName=${gameName}`);
    console.log(`[Playtime] sessionData:`, JSON.stringify(sessionData));

    gamesApi.saveQualifiedSession(gameId, sessionData).then(result => {
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
            devTools:                   !isProductionBuild(),
            webSecurity:                true,   // re-enabled; CDN scripts removed (see dashboard.html)
            webviewTag:                 true,   // renderer uses <webview> for YouTube trailers
            allowRunningInsecureContent: false,
            // sandbox: true is intentionally omitted - our preload uses webUtils/shell from
            // require('electron') which are not available in fully sandboxed preloads
            // on Electron 28.  Revisit after full upgrade to Electron 34+.
        }
    });

    mainWindow.on('close', (event) => {
        if (!isQuitting) { event.preventDefault(); mainWindow.hide(); }
    });

    // -- Security hardening --
    // Deny all permission requests from the renderer (camera, mic, geolocation...)
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
    // --

    // -- Webview security: only allow YouTube embed URLs --
    // Matches youtube.com/embed/ID and youtube-nocookie.com/embed/ID
    const _YT_EMBED_RE = /^https:\/\/www\.(youtube(?:-nocookie)?\.com)\/embed\/[a-zA-Z0-9_-]{11}(\?|$)/;
    const _YT_ALLOWED  = /^https:\/\/(www\.)?(youtube(-nocookie)?\.com|youtu\.be|ytimg\.com|googlevideo\.com|gstatic\.com|google\.com)\//;

    mainWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
        // Strip any injected preload scripts
        delete webPreferences.preload;
        delete webPreferences.preloadURL;

        // Force locked-down permissions - watch URLs and arbitrary pages are not allowed
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
    // --

    mainWindow.maximize();
    mainWindow.loadFile(path.join(__dirname, 'src', 'dashboard.html'));

    // In packaged builds, mirror all renderer console output to a log file.
    // This makes post-install diagnosis possible without DevTools.
    if (isProductionBuild()) {
        const _logPath = require('path').join(app.getPath('userData'), 'protected-renderer-runtime.log');
        const _logFs   = require('fs');
        const _levels  = ['verbose', 'info', 'warning', 'error'];
        mainWindow.webContents.on('console-message', (_ev, level, message, line, sourceId) => {
            const entry = '[' + new Date().toISOString() + '] [' + (_levels[level] || 'info') + '] ' +
                          message + ' (' + sourceId + ':' + line + ')\n';
            try { _logFs.appendFileSync(_logPath, entry); } catch (_) {}
        });
    }

    mainWindow.once('ready-to-show', () => {
        if (isStartupLaunch) {
            // Boot-time launch: stay hidden in tray, do not steal focus.
            console.log('[Startup] launched hidden to tray');
        } else {
            mainWindow.show();
        }

        // Auto-updater check - delayed at boot to avoid hitting the network
        // before Windows has fully initialised the network stack.
        runAfterStartupGrace('checkForUpdates', () => {
            if (autoUpdater) {
                autoUpdater.checkForUpdates().catch(err => console.warn('[AutoUpdater] Startup check failed:', err.message));
                setInterval(() => autoUpdater && autoUpdater.checkForUpdates().catch(err => console.warn('[AutoUpdater] Periodic check failed:', err.message)), 14400000);
            }
        }, 60000);

        // Background library sync - fires 12 s after window shows (or after the
        // startup grace period) so the first render cycle settles first.
        if (process.env.BADDEL_DISABLE_STARTUP_SYNC !== '1') {
            runAfterStartupGrace('autoSyncOnStartup', () => autoSyncOnStartup(), 45000);
        } else {
            console.log('[DEV] Startup platform auto-sync disabled via BADDEL_DISABLE_STARTUP_SYNC=1');
        }
    });
}

// -- Webview security: navigation + popup hardening for all new webContents --
// Runs for every WebContents including <webview> instances in the renderer.
app.on('web-contents-created', (_event, contents) => {
    // Production DevTools lockdown: covers main window, overlay, and all webviews.
    if (isProductionBuild()) {
        contents.on('before-input-event', _blockDevToolsInput);
        contents.on('devtools-opened', () => contents.closeDevTools());
    }
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

require('./handlers/windowHandlers').register(ipcMain, {
    getMainWindow: () => mainWindow,
    app,
});

// ── Runtime diagnostics IPC handler ──────────────────────────────────────────
// Receives log-runtime-error from the renderer (via preload logRuntimeError) and
// appends the message to protected-renderer-runtime.log in userData.  Only active
// in packaged builds so development noise is not written to disk.
ipcMain.handle('log-runtime-error', (_event, message) => {
    if (!isProductionBuild()) return;
    const logPath = require('path').join(app.getPath('userData'), 'protected-renderer-runtime.log');
    const line = '[' + new Date().toISOString() + '] ' + String(message) + '\n';
    try { require('fs').appendFileSync(logPath, line); } catch (_) {}
});

// ============================================================
// IMAGE CACHE
// ============================================================
let CACHE_DIR;

// ============================================================
// APP STARTUP
// ============================================================
app.setAppUserModelId('com.baddel.launcher.beta');

// ... app.whenReady - custom scheme Steam ... redirect login
protocol.registerSchemesAsPrivileged([
    { scheme: 'baddelsteam', privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);

app.whenReady().then(async () => {
    // -- Startup diagnostics - logged before anything else can throw --
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

    // -- Auto-updater (must be after app is ready - electron-updater reads package.json) --
    setupAutoUpdater();

    // Analytics init - deferred at boot so the network flush doesn't fail during
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

    // -- Games feature IPC — primary registration via games adapter (Phase 3.3) --
    // All four legacy handler groups (installedGames, gameLibrary, image, localMetadata)
    // are now registered through gamesIpc.register, which delegates to them internally.
    // imageHandlers moved here from module-level: safe because createWindow() is called
    // at line ~1990, well after this block, so the renderer cannot send IPC before then.
    // Shadow routing for get-game-by-id and get-hidden-games is preserved from Phase 3.2.
    // Rollback: restore the four individual .register() calls and the pre-whenReady imageHandlers block.
    const installedGamesState = { backgroundScanInProgress: false };
    const _gamesDeps = {
        // installedGamesHandlers
        refetchMissingImages,
        runBackgroundMetadataPipeline,
        installedGamesState,
        // gameLibraryHandlers
        removeGame,
        renameGame,
        unhideAllGames,
        getHiddenGames,
        restoreSpecificGames,
        deleteGamePermanently,
        reorderLibrary,
        getDynamicGameExes,
        _detectPlatform,
        addManualGame,
        // imageHandlers
        app,
        dialog,
        imageWebpCache,
        fileURLToPath,
        _collectImageCacheIdsFromGame,
        _readReadyToInstallProtectedImageIds,
        IMAGE_CACHE_PRUNE_GRACE_MS,
        updateGameImage,
        setGameArtwork: (id, updates, opts) => getJsonGameRepository().setGameArtwork(id, updates, opts),
        resetGameArtwork: (id, opts) => getJsonGameRepository().resetGameArtwork(id, opts),
        resetGameImage,
        // localMetadataHandlers
        updateGameMetadata,
        saveFullMetadata,
        loadFullMetadata,
        // shared across all four handler groups
        ipcValidation,
        getSavedGames,
        scanAllGames,
        jsonGameRepository: getJsonGameRepository(),
        analytics,
        shell,
        path,
        fs,
        getMainWindow: () => mainWindow,
    };
    gamesIpc.register(ipcMain, _gamesDeps);
    // -- Playtime IPC (moved to handlers/playtimeHandlers.js) --
    require('./handlers/playtimeHandlers').register(ipcMain, {
        updatePlaytime,
        setTimeTrackingEnabled,
        getTimeTrackingEnabled,
        activeTrackers,
    });

    require('./handlers/launcherPathHandlers').register(ipcMain, {
        dialog,
        getMainWindow:        () => mainWindow,
        riotPathResolver:     require('./services/riotPathResolver'),
        launcherPathResolver: require('./services/launcherPathResolver'),
    });

    require('./handlers/creatorPageHandlers').register(ipcMain, {
        dialog,
        getMainWindow: () => mainWindow,
        fs,
        path,
        app,
        fileURLToPath,
    });


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

    console.log(`[Achievements] > app=${normalizedAppId} accounts=${accounts.length} ownerIds=[${ownerIds.join(',')}]`);

    // Bootstrap auth once if bridge has no active session yet.
    if (!activeSessionId) {
        const firstCred = Object.values(allCreds)[0] || null;
        if (firstCred) {
            try {
                console.log(`[Achievements] BOOTSTRAP >`);
                const boot = await withTimeout(
                    steamBridge.authenticate(firstCred, { waitForCache: false }),
                    12000,
                    'Steam auth bootstrap'
                );
                if (boot?.status === 'authenticated' && boot?.steamId) {
                    activeSessionId = String(boot.steamId);
                    console.log(`[Achievements] BOOTSTRAP < session=${activeSessionId}`);
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
                        console.log(`[Achievements] AUTH > ${displayName} (from ${activeSessionId || 'none'})`);
                        authRes = await withTimeout(
                            steamBridge.authenticate(creds, { waitForCache: false }),
                            20000,
                            `Steam auth (${displayName})`
                        );
                        console.log(`[Achievements] AUTH < ${displayName} status=${authRes?.status} steamId=${authRes?.steamId ?? 'n/a'}`);
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
                console.log(`[Achievements] CACHE  ${displayName} - waiting for session ready`);
                await steamBridge.waitForCacheReady(accountId, 35_000);
                console.log(`[Achievements] CACHE ... ${displayName} - session ready`);
            }

            // Guard against stale session switching.
            const currentSessionId = String(steamBridge.getLastSessionSteamId?.() || '');
            if (currentSessionId && currentSessionId !== accountId) {
                console.warn(`[Achievements] Session mismatch - expected ${accountId}, got ${currentSessionId}`);
                rows.push({
                    accountId,
                    displayName,
                    unlockedCount: 0,
                    unlocked: [],
                    error: 'Session mismatch',
                });
                continue;
            }

            // 120s per-account budget - must exceed Python's wait_ready(60) + wait_metadata_ready(30)
            // which can take up to 90s on a cold CM connection. The bridge itself allows 180s;
            // this 120s safety net sits between the two so a genuinely hung account fails
            // individually without consuming the entire outer UI timeout.
            console.log(`[Achievements] FETCH > ${displayName} app=${normalizedAppId}`);
            const achRes = await withTimeout(
                steamBridge.getAchievements([normalizedAppId]),
                120_000,
                `Steam achievements (${displayName}, app ${normalizedAppId})`
            );
            const unlocked = Array.isArray(achRes?.achievements?.[normalizedAppId])
    ? achRes.achievements[normalizedAppId]
    : [];

// : ... Steam schema
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
    .replace(/[\u2122\u00ae\u00a9]/g, '')
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
        `[Achievements] FETCH < ${displayName} unlocked=${unlockedCount} total=${totalCount ?? 'unknown'} all=${allAchievements.length}`
    );

    rows.push({
        accountId,
        displayName,
        totalCount,
        unlockedCount,

        unlocked,

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
    console.log(`[Achievements] < app=${normalizedAppId} rows=${rows.length} ok=${rows.filter(r => !r.error && !r.skipped).length}`);

    rows.sort((a, b) => b.unlockedCount - a.unlockedCount);
    const result = { status: 'success', appId: normalizedAppId, accounts: rows };
    _achievementsResultCache.set(cacheKey, { ts: Date.now(), value: result });
    return result;
}


    // -- Metadata IPC (moved to handlers/gameMetadataHandlers.js) --
    require('./handlers/gameMetadataHandlers').register(ipcMain, {
        baddelApi,
        mrm: gamesApi.resolutionManager,
        generateMetadataCandidates,
    });
    
    // -- Achievement IPC (moved to handlers/achievementHandlers.js) --
    require('./handlers/achievementHandlers').register(ipcMain, {
        _extractSteamAppId,
        _enqueueAchievementFetch,
        _fetchAchievementsForApp,
    });

    // ---- Collections (moved to handlers/collectionHandlers.js) ----
    require('./handlers/collectionHandlers').register(ipcMain, { colHandler, analytics });

    // -- Baddel Server IPC (moved to handlers/baddelApiHandlers.js) --
    require('./handlers/baddelApiHandlers').register(ipcMain, { baddelApi });

    createWindow();
    createTray();
    registerAccountHandlers(ipcMain);
    registerPlatformSyncHandlers(ipcMain, () => mainWindow);

    // -- Account Shortcuts IPC (moved to handlers/accountShortcutHandlers.js) --
    require('./handlers/accountShortcutHandlers').register(ipcMain, { accountShortcuts });

    // Register global shortcuts - fires switchAccountByPlatform and shows a notification.
    await accountShortcuts.registerAll(async (platform, accountId, accountName) => {
        try {
            new Notification({ title: 'Baddel', body: `Switching to ${accountName}...` }).show();
        } catch {}
        return switchAccountByPlatform(platform, accountId);
    });

    // -- Quick Switcher IPC (moved to handlers/quickSwitcherHandlers.js) --
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

    // -- Wire up background metadata pipeline dependencies --
    // The local metadata resolver is kept for compatibility but is a no-op.
    // All non-Steam/Epic resolution now flows through MetadataResolutionManager
    // (mrm.resolve()) in both runBackgroundMetadataPipeline and get-game-metadata.
    gamesApi.registerLocalMetadataResolver(async (gameName, hints = {}) => {
        try {
            const platform = (hints.platform || '').toLowerCase().trim();
            // Steam/Epic are handled by the server enrich pipeline - skip here.
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
    gamesApi.registerImageDownloader(_downloadAssetsToCache);
    registerPlatformSyncAssetDownloader(_downloadAssetsToCache);

    console.log('[Startup] Background metadata pipeline dependencies registered.');

    // Analytics startup snapshot
    try {
        const [games, collections] = await Promise.all([
            gamesApi.getSavedGames(),
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
// On Windows, path+args together identify the registry entry - both calls must use the same values.
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
        // User has explicitly toggled - honour their choice unconditionally.
        applyStartupSetting(!!prefs.startupEnabled, 'user-preference');
    } else {
        // No explicit user preference yet -> enable startup by default.
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

// ---- External-link handlers (open-external-url, open-community-url - moved to handlers/externalLinkHandlers.js) ----
require('./handlers/externalLinkHandlers').register(ipcMain, { shell, ipcValidation, safeLauncher });

// -- Update notes IPC (moved to handlers/updateNotesHandlers.js) --
require('./handlers/updateNotesHandlers').register(ipcMain, { getPendingUpdateNotesPayload, markUpdateNotesShown, app });


// -- Launch handlers (launch-game, launcher:open-install-url) --------------------
require('./handlers/launchHandlers').register(ipcMain, {
    getSavedGames,
    startGameTracking,
    _detectPlatform,
    shell,
    fsSync,
    path,
    safeLauncher,
    analytics,
    app,
});

// ---- Analytics handlers (consent, log events - moved to handlers/analyticsHandlers.js) ----
require('./handlers/analyticsHandlers').register(ipcMain, { analytics, fs, app });

// get-app-version moved to handlers/windowHandlers.js
// YouTube trailers are now rendered via <webview> tag in the renderer.
// The will-attach-webview + web-contents-created handlers above enforce security.
