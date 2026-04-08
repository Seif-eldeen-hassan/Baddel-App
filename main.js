const { app, BrowserWindow, ipcMain, shell, Tray, Menu, dialog, session, protocol } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const { BrowserView } = require('electron');

const { scanAllGames, addManualGame, getSavedGames } = require('./gameScanner');
const colHandler = require('./collectionsHandler');
const { searchGame } = require('./services/steamgriddb');
const { fetchGameInfo } = require('./services/rawg');
const { fetchFromIGDB } = require('./services/igdb');
const { registerAccountHandlers } = require('./accountsHandler');
const { registerPlatformSyncHandlers } = require('./platformSync');
const analytics = require('./analytics');
const psList = require('ps-list');
const https = require('https');


// ============================================================
// AUTO UPDATER
// ============================================================
autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'Seif-eldeen-hassan',
    repo: 'Baddel-Releases'
});

autoUpdater.on('update-downloaded', (info) => {
    if (mainWindow) mainWindow.webContents.send('update-available', info.version);
});

ipcMain.on('restart-and-update', () => {
    isQuitting = true;
    if (mainWindow) {
        mainWindow.removeAllListeners('close');
        mainWindow.close();
        mainWindow = null;
    }
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
});



// ============================================================
// GLOBALS
// ============================================================
let mainWindow;
let tray = null;
let isQuitting = false;

const driveCache = { data: null, lastFetched: 0 };
const DRIVE_CACHE_TTL = 60_000;

// ============================================================
// SINGLE INSTANCE LOCK
// ============================================================
const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
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
    console.error(error);
    dialog.showErrorBox('Crashing Error', error.stack || error.message);
    process.exit(1);
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
    
    if (words.length > 1) {
        // مثال: "Rainbow Six Siege" -> "rss"
        aliases.add(words.map(w => w[0]).join('')); 
        // مثال: "Assassins Creed Valhalla" -> "acvalhalla"
        if (words[0] === 'assassins' && words[1] === 'creed') {
            aliases.add('ac' + words.slice(2).join('')); 
        }
    }
    return [...aliases];
}

const activeTrackers = {};
async function isGameRunning(command, gamePath, gameName, gameId, isDebugTick = false) {
    try {
        const { default: psList } = await import('ps-list');
        const processes = await psList(); 
        
        const cmdLower = (command || '').toLowerCase();
        const pathLower = (gamePath || '').toLowerCase().replace(/"/g, '').trim();
        const nameLower = (gameName || '').toLowerCase();
        const cleanGameName = nameLower.replace(/[^a-z0-9]/g, '');

        const ignoredExes = ['explorer.exe', 'steam.exe', 'epicgameslauncher.exe', 'riotclientservices.exe', 'eadesktop.exe', 'upc.exe', 'cmd.exe', 'game.exe', 'launcher.exe', 'client.exe', 'host.exe'];

        // جلب الـ Exes ديناميكياً
        const gameExes = await getDynamicGameExes(gameId, pathLower);

        for (const p of processes) {
            const pName = p.name.toLowerCase();
            const pCmd = (p.cmd || '').toLowerCase();
            const cleanProcessName = pName.replace('.exe', '').replace(/[^a-z0-9]/g, '');

            if (ignoredExes.includes(pName)) continue;

            // 1. التطابق الديناميكي من الفولدر
            if (gameExes.includes(pName)) return true;

            // 2. Riot Games — Win10 compatible detection
            // On Win10 ps-list may not expose --launch-product in cmd; we match
            // by the well-known game EXEs directly as a reliable fallback.
            const RIOT_GAME_EXES = [
                'valorant-win64-shipping.exe',
                'leagueclient.exe',
                'league of legends.exe'
            ];
            if (RIOT_GAME_EXES.includes(pName)) return true;
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
                if (cleanGameName === cleanProcessName || 
                    cleanGameName.includes(cleanProcessName) || 
                    cleanProcessName.includes(cleanGameName)) {
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

function startGameTracking(gameId, command, gamePath, gameName) {
    if (activeTrackers[gameId]) return;

    activeTrackers[gameId] = {
        clickTime: Date.now(),      // الوقت اللي داس فيه Play
        actualStartTime: null,      // الوقت الفعلي اللي اللعبة فتحت فيه
        intervalId: null,
        wasRunning: false,
        checkCount: 0,
        platform: _detectPlatform(command),
        lastSavedMinutes: 0         // عشان نتتبع الدقايق اللي اتحفظت (للحفظ التراكمي)
    };

    activeTrackers[gameId].intervalId = setInterval(async () => {
        const tracker = activeTrackers[gameId];
        tracker.checkCount++;
        const isDebugTick = tracker.checkCount <= 4 && !tracker.wasRunning;
        const isRunning = await isGameRunning(command, gamePath, gameName, isDebugTick);

        if (isRunning) {
            if (!tracker.wasRunning) {
                // أول مرة الليكتشف إن اللعبة فتحت
                tracker.wasRunning = true;
                tracker.actualStartTime = Date.now(); // نبدأ نعد من هنا
            }

            // 🟢 الحفظ التراكمي (Periodic Save): هنحفظ كل 5 دقايق احتياطي
            const elapsed = Date.now() - tracker.actualStartTime;
            const currentMinutes = Math.floor(elapsed / 60_000);
            if (currentMinutes - tracker.lastSavedMinutes >= 5) {
                const minsToSave = currentMinutes - tracker.lastSavedMinutes;
                require('./gameScanner').updatePlaytime(gameId, minsToSave);
                tracker.lastSavedMinutes = currentMinutes;
            }
            return;
        }

        // لو وصلنا هنا، يعني اللعبة مش شغالة حالياً
        const timeSinceClick = Date.now() - tracker.clickTime;

        if (tracker.wasRunning || timeSinceClick > 300_000) {
            clearInterval(tracker.intervalId);
            
            if (tracker.wasRunning) {
                saveTrackerPlaytime(gameId, tracker, gameName);
            }
            
            delete activeTrackers[gameId];
        }
    }, 10_000);
}



function startGlobalWatcher() {
    setInterval(async () => {
        try {
            const { default: psList } = await import('ps-list');
            const processes = await psList(); 
            const games = getSavedGames(); 

            for (const game of games) {
                if (activeTrackers[game.id]) continue; 

                let isRunning = false;
                const command = (game.command || '').toLowerCase();
                const gamePath = (game.path || '').toLowerCase().replace(/"/g, '').trim();
                const gameName = (game.name || '').toLowerCase();
                const cleanGameName = gameName.replace(/[^a-z0-9]/g, '');

                const ignoredExes = [
                    'explorer.exe', 'steam.exe', 'epicgameslauncher.exe', 
                    'riotclientservices.exe', 'eadesktop.exe', 'upc.exe', 
                    'cmd.exe', 'game.exe', 'launcher.exe', 'client.exe', 'host.exe'
                ];

                const gameExes = await getDynamicGameExes(game.id, gamePath);

                for (const p of processes) {
                    const pName = p.name.toLowerCase();
                    const pCmd = (p.cmd || '').toLowerCase();

                    if (ignoredExes.includes(pName)) continue;

                    const cleanProcessName = pName.replace('.exe', '').replace(/[^a-z0-9]/g, '');
                    let isMatch = false;

                    if (gameExes.includes(pName)) {
                        isMatch = true;
                    }

                    const RIOT_GAME_EXES = ['valorant-win64-shipping.exe', 'leagueclient.exe', 'league of legends.exe'];
                    if (!isMatch && RIOT_GAME_EXES.includes(pName)) {
                        isMatch = true;
                    }
                    if (!isMatch && command.includes('riotclientservices.exe')) {
                        const productMatch = command.match(/--launch-product=([a-z_]+)/i);
                        if (productMatch?.[1]) {
                            const product = productMatch[1].toLowerCase();
                            const targetExe = product === 'valorant' ? 'valorant-win64-shipping.exe' :
                                              product.includes('league') ? 'leagueclient.exe' :
                                              product + '.exe';
                            if (pName === targetExe) isMatch = true;
                        }
                    }

                    if (!isMatch && gamePath && gamePath.length > 5 && pCmd.includes(gamePath)) {
                        isMatch = true; 
                    }

                    if (!isMatch && cleanGameName && cleanProcessName.length >= 3) {
                        // تطابق بالاسم العادي
                        if (cleanGameName === cleanProcessName || 
                            cleanGameName.includes(cleanProcessName) || 
                            cleanProcessName.includes(cleanGameName)) {
                            isMatch = true;
                        } else {
                            // توليد اختصارات ديناميكية ومقارنتها (زي acvalhalla)
                            const dynamicAliases = generateDynamicAliases(gameName);
                            if (dynamicAliases.includes(cleanProcessName)) {
                                isMatch = true;
                            }
                        }
                    }

                    if (isMatch) {
                        isRunning = true;
                        break;
                    }
                }

                if (isRunning) {
                    console.log(`[Global Watcher] 🎯 Caught external launch for: ${game.name}`);
                    startGameTracking(game.id, game.command, game.path, game.name);
                }
            }
        } catch (err) {
        }
    }, 15000); 
}

function saveTrackerPlaytime(gameId, tracker, gameName) {
    if (!tracker.wasRunning || !tracker.actualStartTime) return;
    const elapsed = Date.now() - tracker.actualStartTime;
    let totalMinutes = Math.round(elapsed / 60_000);
    if (totalMinutes === 0) {
        totalMinutes = 1;
    }
    
    const unsavedMinutes = Math.max(0, totalMinutes - tracker.lastSavedMinutes);

    require('./gameScanner').updatePlaytime(gameId, unsavedMinutes).then(result => {
        if (mainWindow && result.status === 'success') {
            mainWindow.webContents.send('playtime-updated', {
                gameId,
                totalMinutes: result.totalPlaytime,
                lastPlayed: result.lastPlayed,
                playSessions: result.playSessions
            });
        }
        analytics.logSessionEnded(tracker.platform || 'unknown', totalMinutes).catch(() => {});
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
        backgroundColor: '#121212',
        frame: false,
        titleBarStyle: 'hidden',
        icon: path.join(__dirname, 'Logo.ico'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            webSecurity: false,  
            webviewTag: true,    
            allowRunningInsecureContent: true 
        }
    });

    mainWindow.on('close', (event) => {
        if (!isQuitting) { event.preventDefault(); mainWindow.hide(); }
    });

    mainWindow.maximize();
    mainWindow.loadFile(path.join(__dirname, 'src', 'dashboard.html'));
    mainWindow.once('ready-to-show', () => {
        autoUpdater.checkForUpdatesAndNotify();
        setInterval(() => autoUpdater.checkForUpdatesAndNotify(), 14400000); 
    });
}

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
// ✅ لازم يتسجل قبل app.whenReady — بيعرّف الـ custom scheme اللي Steam بيعمل redirect ليه بعد login
protocol.registerSchemesAsPrivileged([
    { scheme: 'baddelsteam', privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);

app.whenReady().then(async () => {
    await analytics.init(); // starts PostHog queue + GA4 realtime heartbeat
    setupWindowsIntegration();
    refreshDriveCache();
    startGlobalWatcher();

    CACHE_DIR = path.join(app.getPath('userData'), 'image_cache');
    require('fs').mkdirSync(CACHE_DIR, { recursive: true });

    // ---- Image Caching ----
    ipcMain.handle('cache-image', async (_, url, gameId, type) => {
        if (!url || url.startsWith('file://') || url.startsWith('assets/')) return url;
        try {
            const ext = path.extname(url.split('?')[0]) || '.jpg';
            const localPath = await downloadImage(url, `${type}_${gameId}${ext}`);
            return `file://${localPath.replace(/\\/g, '/')}`;
        } catch (err) {
            console.error(`[Cache] Failed for ${gameId} (${type}):`, err.message);
            return url;
        }
    });

    ipcMain.handle('cache-all-assets', async (_, assets, gameId) => {
        const results = {};
        await Promise.all(Object.entries(assets).map(async ([type, url]) => {
            if (!url) return;
            try {
                const ext = path.extname(url.split('?')[0]) || '.jpg';
                const localPath = await downloadImage(url, `${type}_${gameId}${ext}`);
                results[type] = `file://${localPath.replace(/\\/g, '/')}`;
            } catch {
                results[type] = url;
            }
        }));
        return results;
    });

    // ---- Games Library ----
    ipcMain.handle('get-installed-games', async () => {
        const stored = getSavedGames();

        // Helper: notify renderer when a single game's images are ready
        const notifyGameImageUpdated = (game) => {
            if (mainWindow) mainWindow.webContents.send('game-image-updated', game);
        };

        if (stored.length === 0) {
            // Fresh install / wiped DB — scan first, then refetch missing images
            const games = await scanAllGames();
            // Fire image refetch in background; renderer gets live updates via 'game-image-updated'
            require('./gameScanner').refetchMissingImages(notifyGameImageUpdated).catch(() => {});
            return games;
        }

        // Return stored immediately, sync in background
        scanAllGames().then(updated => {
            if (mainWindow) mainWindow.webContents.send('library-updated', updated);
            // After scan, re-fetch images for any game still missing a cover
            require('./gameScanner').refetchMissingImages(notifyGameImageUpdated).catch(() => {});
        });
        return stored;
    });

    ipcMain.handle('add-manual-game', async (_, exePath, customName) => {
        if (exePath.toLowerCase().endsWith('.lnk')) {
            try {
                const details = shell.readShortcutLink(exePath);
                if (details.target) exePath = details.target;
            } catch { /* ignore shortcut errors */ }
        }
        
        // 🔴 إنشاء الدالة اللي هتبعت الإشعار للـ Frontend
        const notifyGameImageUpdated = (game) => {
            if (mainWindow) mainWindow.webContents.send('game-image-updated', game);
        };

        // 🔴 تمرير الدالة للـ Scanner
        const result = await require('./gameScanner').addManualGame(exePath, customName, notifyGameImageUpdated);
        if (result.status === 'success') {
            analytics.logGameAddedManual().catch(() => {});
        }
        return result;
    });

    ipcMain.handle('remove-game', async (_, id) => {
        const games = await getSavedGames(); 
        const game = games.find(g => g.id === id);
        const platform = _detectPlatform(game?.command);
        const result = await require('./gameScanner').removeGame(id);
        analytics.logGameRemoved(platform).catch(() => {});
        return result;
    });
    ipcMain.handle('rename-game', (_, id, name) => require('./gameScanner').renameGame(id, name));
    ipcMain.handle('scan-all-games', async () => {
        const games = await require('./gameScanner').scanAllGames();
        const platforms = [...new Set(games.map(g => g.platform).filter(Boolean))];
        analytics.logLibraryScanned(games.length, platforms).catch(() => {});
        return games;
    });
    ipcMain.handle('analytics-log-hud-sensor', (_, isEnabled) => {
        analytics.logHudSensorToggled(isEnabled).catch(() => {});
    });
    ipcMain.handle('unhide-all-games', () => require('./gameScanner').unhideAllGames());
    ipcMain.handle('get-hidden-games', () => require('./gameScanner').getHiddenGames());
    ipcMain.handle('restore-specific-games', async (_, ids) => {
        const result = await require('./gameScanner').restoreSpecificGames(ids);
        if (result.status === 'success') analytics.logGameRestored(ids.length).catch(() => {});
        return result;
    });
    ipcMain.handle('delete-game-permanently', async (_, id) => {
        const result = await require('./gameScanner').deleteGamePermanently(id);
        if (result.status === 'success') analytics.logGameDeletedForever().catch(() => {});
        return result;
    });
    ipcMain.handle('reorder-library', (_, ids) => require('./gameScanner').reorderLibrary(ids));
    ipcMain.handle('save-game-metadata', (_, id, meta) => require('./gameScanner').updateGameMetadata(id, meta));
    ipcMain.handle('update-playtime', (_, id, mins) => require('./gameScanner').updatePlaytime(id, mins));

    // ---- Images ----
    ipcMain.handle('select-game-image', async () => {
        const result = await dialog.showOpenDialog(mainWindow, {
            properties: ['openFile'],
            filters: [{ name: 'Images', extensions: ['jpg', 'png', 'jpeg', 'webp'] }]
        });
        return result.canceled ? null : result.filePaths[0];
    });
   

    ipcMain.handle('analytics-log-image-changed', (_, type, isReset) => {
        analytics.logGameImageChanged(type, isReset).catch(() => {});
    });
    
    ipcMain.handle('analytics-log-feedback', () => {
        analytics.logFeedbackSent().catch(() => {});
    });

    // Check if a game has a cached image on disk (used as fast fallback after reinstall)
    ipcMain.handle('get-cached-image', (_, gameId, type) => {
        try {
            const cacheDir = require('path').join(app.getPath('userData'), 'image_cache');
            const fs = require('fs');
            if (!fs.existsSync(cacheDir)) return null;
            const files = fs.readdirSync(cacheDir);
            const found = files.find(f => f.startsWith(`${type}_${gameId}`));
            return found ? `file://${require('path').join(cacheDir, found).replace(/\\/g, '/')}` : null;
        } catch { return null; }
    });

    ipcMain.handle('update-game-image', (_, id, imgPath, type) =>
        require('./gameScanner').updateGameImage(id, imgPath, type));
    ipcMain.handle('reset-game-image', (_, id, type) =>
        require('./gameScanner').resetGameImage(id, type));

    // ---- File System Browser ----
    ipcMain.handle('get-drives', async () => {
        const now = Date.now();
        if (!driveCache.data || now - driveCache.lastFetched >= DRIVE_CACHE_TTL) {
            await refreshDriveCache();
        }
        const drives = driveCache.data || [{ path: 'C:\\', label: 'Local Disk' }];

        const icons = {
            desktop:   `<svg viewBox="0 0 24 24" fill="none" stroke="#0a84ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`,
            downloads: `<svg viewBox="0 0 24 24" fill="none" stroke="#30d158" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
            documents: `<svg viewBox="0 0 24 24" fill="none" stroke="#bf5af2" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
            pictures:  `<svg viewBox="0 0 24 24" fill="none" stroke="#ff9f0a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,
            videos:    `<svg viewBox="0 0 24 24" fill="none" stroke="#ff453a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/></svg>`,
            drive:     `<svg viewBox="0 0 24 24" fill="none" stroke="#8e8e93" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="12" x2="2" y2="12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>`
        };

        const quickAccess = [
            { path: app.getPath('desktop'),   label: 'Desktop',   isQuick: true, icon: icons.desktop },
            { path: app.getPath('downloads'), label: 'Downloads', isQuick: true, icon: icons.downloads },
            { path: app.getPath('documents'), label: 'Documents', isQuick: true, icon: icons.documents },
            { path: app.getPath('pictures'),  label: 'Pictures',  isQuick: true, icon: icons.pictures },
            { path: app.getPath('videos'),    label: 'Videos',    isQuick: true, icon: icons.videos }
        ];
        return [...quickAccess, ...drives.map(d => ({ ...d, icon: icons.drive }))];
    });

    ipcMain.handle('list-directories', async (_, targetPath) => {
        if (!targetPath) return [];
        let cleanPath = path.normalize(targetPath);
        if (cleanPath.length === 2 && cleanPath.endsWith(':')) cleanPath += path.sep;

        const ALLOWED_EXTS = new Set(['.exe', '.lnk', '.url', '.bat']);
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

    // ---- Game Launch ----
    ipcMain.handle('launch-game', async (_, command, gameId, gamePath, gameName) => {
        const cleanCmd = command.replace(/"/g, '').trim();
        try {
            let launchSuccess = false;

            if (cleanCmd.includes('://')) {
                await new Promise(resolve => {
                    exec(`start "" "${cleanCmd}"`, err => {
                        if (err) shell.openExternal(cleanCmd).then(() => resolve(true)).catch(() => resolve(false));
                        else resolve(true);
                    });
                });
                launchSuccess = true;
            } else if (cleanCmd.toLowerCase().endsWith('.lnk')) {
                const err = await shell.openPath(cleanCmd);
                if (err) throw new Error(err);
                launchSuccess = true;
            } else {
                launchSuccess = await new Promise(resolve => {
                    const child = exec(command);
                    child.on('error', () => resolve(false));
                    setTimeout(() => resolve(true), 500);
                });
            }

            if (launchSuccess) {
                startGameTracking(gameId, command, gamePath, gameName);
                analytics.logGameLaunched(_detectPlatform(command)).catch(() => {});
            }
            return { status: 'success' };
        } catch (err) {
            console.error('[Launch Error]', err);
            return { status: 'error', message: 'Game not found or protocol not registered.' };
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

// Steam Storefront (details + images + trailer + requirements)
async function fetchSteamStorefrontData(gameName, hints = {}) {
    try {
        const appId = _extractSteamAppId(gameName, hints) || await _findSteamAppIdByName(gameName);
        if (!appId) return null;

        const detailsRes = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appId}`, {
            headers: {
                'Cookie': 'birthtime=283993201; lastagecheckage=1-January-1980; mature_content=1; wants_mature_content=1'
            }
        });
        const detailsData = await detailsRes.json();
        if (!detailsData[appId]?.success) return null;

        const data = detailsData[appId].data;
        if (!data) return null;

        const trailer = data.movies?.[0]?.mp4?.max || data.movies?.[0]?.webm?.max || null;
        const allTrailers = (data.movies || []).map((movie, i) => ({
            name: movie?.name || `Trailer ${i + 1}`,
            url: movie?.mp4?.max || movie?.webm?.max || null,
            thumbUrl: movie?.thumbnail || null,
        })).filter((t) => !!t.url);

        const screenshots = (data.screenshots || []).map((s) => s.path_full || s.path_thumbnail).filter(Boolean);
        const requirements = data.pc_requirements ? {
            minimum: data.pc_requirements.minimum || null,
            recommended: data.pc_requirements.recommended || null,
        } : null;

        return {
            cover: data.header_image || null,
            heroImage: data.background_raw || data.background || data.capsule_imagev5 || data.header_image || null,
            logo: null,
            info: {
                description: data.detailed_description || data.short_description || null,
                genres: (data.genres || []).map((g) => g.description).filter(Boolean),
                developer: Array.isArray(data.developers) ? data.developers.join(', ') : null,
                publisher: Array.isArray(data.publishers) ? data.publishers.join(', ') : null,
                releaseDate: data.release_date?.date || null,
                rating: typeof data.metacritic?.score === 'number' ? data.metacritic.score : null,
                platforms: Object.entries(data.platforms || {})
                    .filter(([, ok]) => !!ok)
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
            },
        };
    } catch (err) {
        console.error('[Steam Storefront Fetch Error]', err);
        return null;
    }
}

    // ---- Metadata ----
// ---- Metadata ----
ipcMain.handle('get-game-metadata', async (_, gameName, hints = {}) => {
    console.log(`\n======================================`);
    console.log(`🚀 [BACKEND] FETCHING: ${gameName} (PARALLEL & TIMEOUT)`);
    console.log(`======================================`);

    // ⏱️ دالة سحرية بتعمل تايمر: لو الريكويست اتأخر عن الوقت، بنعمله Skip فوراً
    const fetchWithTimeout = (promise, ms, name, fallbackVal = null) => {
        return Promise.race([
            promise,
            new Promise((resolve) => setTimeout(() => {
                console.warn(`⏳ [TIMEOUT] ${name} took longer than ${ms}ms. Skipping!`);
                resolve(fallbackVal); 
            }, ms))
        ]);
    };

    // 🚀 هنطلب التلاتة في نفس الوقت، بس بحد أقصى 3-4 ثواني للسيرفر
    // لو Steam أو غيره هنج، الكود مش هيقف وهيكمل باللي جابه
    const platforms = _normalizePlatformHints(hints);
    const isSteamGame = platforms.includes('steam');

    const igdbPromise = fetchWithTimeout(
        fetchFromIGDB(gameName).catch(e => { console.error('❌ IGDB:', e.message); return null; }),
        4500,
        'IGDB',
        null
    );
    const steamPromise = fetchWithTimeout(
        fetchSteamStorefrontData(gameName, hints).catch(e => { console.error('❌ Steam Storefront:', e.message); return null; }),
        4500,
        'Steam Storefront',
        null
    );
    const rawgPromise = fetchWithTimeout(
        fetchGameInfo(gameName).catch(e => { console.error('❌ RAWG:', e.message); return null; }),
        4000,
        'RAWG',
        null
    );
    const sgdbPromise = fetchWithTimeout(
        searchGame(gameName).catch(e => { console.error('❌ SGDB:', e.message); return null; }),
        4000,
        'SteamGridDB',
        null
    );

    let primary = null;
    let fallback1 = null;
    let fallback2 = null;

    if (isSteamGame) {
        [primary, fallback1] = await Promise.all([steamPromise, igdbPromise]);
    } else {
        [primary, fallback1, fallback2] = await Promise.all([igdbPromise, steamPromise, rawgPromise]);
    }
    const sgdbData = await sgdbPromise;

    console.log(`✅ [APIs] All data fetched (or timed out).`);

    const normalizeRawg = (rawg) => {
        if (!rawg) return null;
        return {
            cover: null,
            heroImage: rawg.screenshots?.[0] || null,
            logo: null,
            info: {
                description: rawg.description || null,
                genres: rawg.genres || [],
                developer: rawg.developers || null,
                publisher: rawg.publishers || null,
                releaseDate: rawg.releaseDate || null,
                rating: rawg.metacritic || null,
                platforms: ['PC'],
                engine: null,
                gameMode: null,
                website: null,
                trailer: rawg.trailer || null,
                allTrailers: rawg.trailer ? [{ name: 'Trailer', url: rawg.trailer, thumbUrl: null }] : [],
                isDirectVideo: !!rawg.trailer,
                artworks: [],
                screenshots: rawg.screenshots || [],
                requirements: rawg.requirements || null,
            },
        };
    };

    const rawgData = normalizeRawg(fallback2);
    const chosenData = primary || fallback1 || rawgData || {};

    // images priority: chosen source first, then SGDB fallback
    const cover     = chosenData?.cover || sgdbData?.cover || null;
    const heroImage = chosenData?.heroImage || chosenData?.hero || sgdbData?.hero || null;
    const logo      = chosenData?.logo || sgdbData?.logo || null;

    const finalTrailer = chosenData?.info?.trailer || null;
    const finalAllTrailers = chosenData?.info?.allTrailers || [];
    const finalScreenshots = chosenData?.info?.screenshots || [];

    console.log(`🎉 [BACKEND] DONE FOR: ${gameName}`);
    console.log(`======================================\n`);

    return {
        cover,
        heroImage,
        hero: heroImage, // عشان الفرونت إند بتاعك
        logo,
        info: {
            ...(chosenData?.info || {}),
            trailer:      finalTrailer,
            allTrailers:  finalAllTrailers,
            screenshots:  finalScreenshots,
            isDirectVideo: finalTrailer?.endsWith('.mp4') || finalTrailer?.endsWith('.webm') || false,
            requirements: chosenData?.info?.requirements || null,
        }
    };
});

    // ---- Collections (registered once, inside whenReady) ----
    ipcMain.handle('get-collections', () => {
        try { return colHandler.getCollections(); }
        catch (err) { console.error('[IPC] get-collections error:', err); return []; }
    });
    ipcMain.handle('create-collection', async (_, name, img) => {
        const result = await colHandler.createCollection(name, img);
        if (result?.status === 'success') analytics.logCollectionCreated(false).catch(() => {});
        return result;
    });
    ipcMain.handle('add-game-collection', async (_, colId, gameId) => {
    const result = await colHandler.addGameToCollection(colId, gameId);
    const isFav = (colId === 'fav_system_default'); 
    analytics.logGameAddedToCollection(isFav).catch(() => {});
    
    return result;
});
    ipcMain.handle('remove-game-collection', async (_, colId, gameId) => {
        const result = await colHandler.removeGameFromCollection(colId, gameId);
        
        const isFav = (colId === 'fav_system_default'); 
        analytics.logGameRemovedFromCollection(isFav).catch(() => {});
        
        return result;
    });
    ipcMain.handle('delete-collection', (_, colId) => colHandler.deleteCollection(colId));
    ipcMain.handle('reorder-collection', (_, colId, order) => colHandler.reorderCollection(colId, order));
    ipcMain.handle('update-collection', (_, colId, name, img) => colHandler.updateCollectionDetails(colId, name, img));

    // ---- System ----
    ipcMain.handle('get-desktop-path', () => app.getPath('desktop'));

    createWindow();
    createTray();
    registerAccountHandlers(ipcMain);
    registerPlatformSyncHandlers(ipcMain, () => mainWindow);

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
// SYSTEM STATS
// ============================================================
let si;
try { si = require('systeminformation'); } catch {
    console.warn('[SysStats] systeminformation not installed. Run: npm install systeminformation');
    si = null;
}

let staticGpuInfo = null;

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

// ============================================================
// WINDOWS INTEGRATION (STARTUP + SHORTCUTS)
// ============================================================
function setupWindowsIntegration() {
    if (!app.isPackaged) return;
    const exePath = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
    app.setLoginItemSettings({ openAtLogin: true, path: exePath, args: ['--hidden'] });

    const shortcutPath = path.join(
        app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Baddel Launcher.lnk'
    );
    try {
        shell.writeShortcutLink(shortcutPath, {
            target: exePath,
            cwd: path.dirname(exePath),
            description: 'The AI Powered Gaming Hub',
            icon: exePath,
            appUserModelId: 'com.baddel.launcher'
        });
    } catch (err) {
        console.error('[Startup] Failed to create shortcuts:', err);
    }
}


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
    // Save in-progress playtime sessions before exit
    for (const [gameId, tracker] of Object.entries(activeTrackers)) {
        clearInterval(tracker.intervalId);
        saveTrackerPlaytime(gameId, tracker);
    }
});

ipcMain.handle('open-external-url', async (event, url) => {
    const { shell } = require('electron');
    await shell.openExternal(url);
});

// ---- Analytics Consent ----
ipcMain.handle('analytics-grant-consent',  () => analytics.grantConsent());
ipcMain.handle('analytics-revoke-consent', () => analytics.revokeConsent());
ipcMain.handle('analytics-is-enabled',     () => analytics.isConsentGiven());
ipcMain.handle('analytics-log-game-spin',  (_, isCustom) => {
        analytics.logGameSpinClicked(isCustom).catch(() => {});
});

