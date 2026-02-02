const { app, BrowserWindow, ipcMain, shell, Tray, Menu, dialog } = require('electron');
const { autoUpdater } = require("electron-updater");
const path = require('path');
const fs = require('fs').promises;
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const https = require('https');


// ==========================================
// 🚀 DIRECT GITHUB UPDATE (NO SERVER NEEDED)
// ==========================================

// بدل ما نستخدم سيرفر وسيط، هنكلم GitHub مباشرة
// ده بيشتغل بس مع الـ Public Repositories (وده وضعنا حالياً)
autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'Seif-eldeen-hassan',   // اسم حسابك
    repo: 'Baddel-Releases'        // اسم الريبو الجديد الببليك
});

// باقي الكود زي ما هو...

autoUpdater.on('update-downloaded', (info) => {
    // بنبعت رقم النسخة الجديدة للـ Frontend
    if (mainWindow) {
        mainWindow.webContents.send('update-available', info.version);
    }
});



ipcMain.on('restart-and-update', () => {
    autoUpdater.quitAndInstall();
});

process.on('uncaughtException', (error) => {
    console.error(error);
    dialog.showErrorBox('Crashing Error', error.stack || error.message);
    process.exit(1);
});



// استيراد المحرك الجديد (تأكد أن ملف gameScanner.js موجود بجانب main.js)
const { scanAllGames, addManualGame, getSavedGames, removeGame } = require('./gameScanner');
const colHandler = require('./collectionsHandler');
// استيراد خدمات البحث (تأكد من وجود الملف)
const { searchGame } = require('./services/steamgriddb');

let mainWindow;
let tray = null;         // متغير للأيقونة اللي تحت
let isQuitting = false;  // متغير عشان نعرف إمتى نقفل بجد

// ==========================================
// 1. DRIVE CACHE SYSTEM (لتحسين سرعة التصفح)
// ==========================================
const driveCache = {
    data: null,
    lastFetched: 0
};
const CACHE_DURATION = 60000; // تحديث كل دقيقة


// 2. ⛔ كود منع التكرار (Single Instance)
// 2. ⛔ كود منع التكرار (Single Instance)
const hasLock = app.requestSingleInstanceLock();

if (!hasLock) {
    app.quit(); // اقفل النسخة الجديدة فوراً
} else {
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        // لو حد حاول يفتح البرنامج وهو مفتوح أصلاً
        if (mainWindow) {
            // 1. لو كان معمولة Minimize رجعه
            if (mainWindow.isMinimized()) mainWindow.restore();
            
            // 2. لو كان مخفي (في الـ Tray) اظهره
            if (!mainWindow.isVisible()) mainWindow.show();
            
            // 3. ركز عليه (Focus)
            mainWindow.focus();

            // 🔥 4. الحركة السحرية: اجباره ييجي فوق كل النوافذ لحظياً عشان يخطف التركيز
            mainWindow.setAlwaysOnTop(true);
            mainWindow.setAlwaysOnTop(false);
        }
    });
}

// 3. كمل باقي الملف عادي جداً (app.whenReady ....)

async function refreshDriveCache() {
    try {
        // استخدام PowerShell لجلب الدرايفات مع أسمائها الحقيقية
        const cmd = 'powershell "[System.IO.DriveInfo]::GetDrives() | Where-Object {$_.DriveType -eq \'Fixed\'} | Select-Object @{n=\'DriveLetter\';e={$_.Name}}, @{n=\'FileSystemLabel\';e={$_.VolumeLabel}} | ConvertTo-Json"';
        const { stdout } = await execAsync(cmd);
        
        if (!stdout.trim()) return;
        let volumes = JSON.parse(stdout);
        if (!Array.isArray(volumes)) volumes = [volumes];

        driveCache.data = volumes.map(v => ({
            path: v.DriveLetter,
            label: (v.FileSystemLabel && v.FileSystemLabel.trim()) ? v.FileSystemLabel : 'Local Disk'
        }));
        driveCache.lastFetched = Date.now();
    } catch (err) {
        console.error("[ERROR] Drive cache refresh failed:", err);
    }
}


function createTray() {
    // التأكد من مسار الأيقونة (لازم يكون Logo.ico موجود جنب main.js)
    const iconPath = path.join(__dirname, 'Logo.ico');
    tray = new Tray(iconPath);

    // القائمة اللي بتظهر لما تدوس كليك يمين على الأيقونة
    const contextMenu = Menu.buildFromTemplate([
        { 
            label: 'Open Baddel Launcher', 
            click: () => mainWindow.show() 
        },
        { type: 'separator' },
        { 
            label: 'Exit', 
            click: () => {
                isQuitting = true; // هنا بنقوله اقفل بجد
                app.quit();
            } 
        }
    ]);

    tray.setToolTip('Baddel Launcher');
    tray.setContextMenu(contextMenu);

    // لما تدوس كليك شمال على الأيقونة يفتح البرنامج
    tray.on('click', () => {
        if (mainWindow.isVisible()) {
            mainWindow.hide();
        } else {
            mainWindow.show();
        }
    });
}

// ==========================================
// 2. WINDOW CREATION
// ==========================================
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280, height: 800,
        backgroundColor: '#121212',
        frame: false, // 👈 دي اللي بتخفي الشريط الأبيض
        titleBarStyle: 'hidden', // عشان نضمن إنه يختفي تماماً
        icon: path.join(__dirname, 'Logo.ico'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });
    // منع الإغلاق عند الضغط على X
    mainWindow.on('close', (event) => {
        if (!isQuitting) {
            event.preventDefault(); // الغي القفل
            mainWindow.hide();      // اخفي النافذة بس
            return false;
        }
    });
    mainWindow.maximize();
    mainWindow.loadFile('dashboard.html');
    mainWindow.once('ready-to-show', () => {
        autoUpdater.checkForUpdatesAndNotify();
    });
}

ipcMain.on('minimize-app', () => {
    if (mainWindow) mainWindow.minimize();
});

ipcMain.on('maximize-app', () => {
    if (mainWindow) {
        if (mainWindow.isMaximized()) {
            mainWindow.unmaximize();
        } else {
            mainWindow.maximize();
        }
    }
});

ipcMain.on('close-app', () => {
    if (mainWindow) mainWindow.close();
});



// ==========================================
// 3. APP LIFECYCLE & IPC HANDLERS
// ==========================================

app.whenReady().then(() => {
    console.log("[DEBUG] Baddel Launcher is starting...");
    setupWindowsIntegration();
    // تشغيل جلب الدرايفات في الخلفية فوراً
    refreshDriveCache();
    // ==========================================
    // 💾 CACHE SYSTEM (Pro Version - Supports Redirects)
    // ==========================================
    
    // 1. تحديد مكان حفظ الصور
    const CACHE_DIR = path.join(app.getPath('userData'), 'image_cache');
    
    // تأكد إن الفولدر موجود (بنستخدم fs الأصلية هنا لضمان الإنشاء)
    require('fs').mkdirSync(CACHE_DIR, { recursive: true });

    // 2. دالة التحميل الحديثة (بتستخدم fetch)
    const downloadImage = async (url, filename) => {
        const filePath = path.join(CACHE_DIR, filename);

        // لو الملف موجود، تأكد إنه مش فاضي (0 bytes)
        try {
            const stats = await fs.stat(filePath);
            if (stats.size > 0) return filePath; 
        } catch (e) {
            // الملف مش موجود، كمل تحميل
        }

        try {
            // استخدام fetch المدمج (بيفهم Redirects و HTTPS)
            const response = await fetch(url);
            
            if (!response.ok) {
                throw new Error(`HTTP Error: ${response.status}`);
            }

            // تحويل البيانات لـ Buffer وحفظها
            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            
            await fs.writeFile(filePath, buffer);
            return filePath;
        } catch (error) {
            // لو فشل، امسح الملف لو اتكون عشان ميكونش فاسد
            try { await fs.unlink(filePath); } catch(e){}
            throw error;
        }
    };

    // 3. استقبال الطلب من الفرونت إند
    ipcMain.handle('cache-image', async (event, url, gameId, type) => {
        // لو الرابط محلي أو فاضي، رجعه زي ما هو
        if (!url || url.startsWith('file://') || url.startsWith('assets/')) return url;

        try {
            // تنظيف الرابط للحصول على الامتداد الصح
            // بعض الروابط بتبقى كدة: image.jpg?width=500
            const cleanUrl = url.split('?')[0]; 
            const extension = path.extname(cleanUrl) || '.jpg';
            const filename = `${type}_${gameId}${extension}`;
            
            const localPath = await downloadImage(url, filename);
            
            // بنرجع المسار بصيغة file://
            return `file://${localPath.replace(/\\/g, '/')}`; 
        } catch (error) {
            console.error(`[Cache Error] Failed to cache ${type} for game ${gameId}:`, error.message);
            return url; // Fallback: رجع رابط النت عشان الصورة متختفيش
        }
    });

    // ------------------------------------------
    // A. نظام الألعاب (Fast Startup + Sync)
    // ------------------------------------------
    
    // 🔥 التعديل هنا: رجعت الاسم لـ 'get-installed-games' عشان يتوافق مع الفرونت إند
    ipcMain.handle('get-installed-games', async () => {
        // 1. جلب البيانات المحفوظة فوراً (سرعة قصوى)
        const storedGames = getSavedGames();
        
        // 2. لو مفيش داتا خالص (أول مرة يفتح)، نعمل سكان كامل وننتظره
        if (storedGames.length === 0) {
            console.log("[DEBUG] Library empty, starting full scan...");
            return await scanAllGames(); 
        }
        
        // 3. لو فيه داتا، شغل السكان في الخلفية (Silent Update)
        scanAllGames().then(updatedGames => {
            if (mainWindow) {
                console.log("[DEBUG] Background scan finished, updating UI...");
                // نبعت إشارة للفرونت إند إن فيه تحديث
                mainWindow.webContents.send('library-updated', updatedGames);
            }
        });

        // 4. رجع البيانات القديمة فوراً عشان البرنامج يفتح
        return storedGames;
    });

    // إضافة لعبة يدوياً (ملف .exe)
    // إضافة لعبة يدوياً (مع حل مشكلة الشورت كت)
    ipcMain.handle('add-manual-game', async (event, exePath, customName) => {
        // 🔥 التعديل: لو الملف .lnk (شورت كت) هات المسار الأصلي بتاعه فوراً
        if (exePath.toLowerCase().endsWith('.lnk')) {
            try {
                const details = shell.readShortcutLink(exePath);
                if (details.target) {
                    console.log(`🔗 Resolved Shortcut: ${exePath} -> ${details.target}`);
                    exePath = details.target; // استبدل المسار بالمسار الحقيقي
                }
            } catch(e) { console.error("Shortcut resolve error", e); }
        }
        
        return await require('./gameScanner').addManualGame(exePath, customName);
    });

    // حذف لعبة
    ipcMain.handle('remove-game', async (event, id) => {
        // 🔥 لازم كلمة return تكون موجودة عشان الفرونت إند يعرف النتيجة
        return await require('./gameScanner').removeGame(id);
    });

    // إعادة تسمية لعبة
    ipcMain.handle('rename-game', async (event, gameId, newName) => {
        return await require('./gameScanner').renameGame(gameId, newName);
    });

    ipcMain.handle('unhide-all-games', async () => {
        return await require('./gameScanner').unhideAllGames();
    });
    
    // وتأكد إن ده موجود عشان الـ Scan العادي
    ipcMain.handle('scan-all-games', async () => {
        return await require('./gameScanner').scanAllGames();
    });

    ipcMain.handle('delete-game-permanently', async (event, id) => {
        return await require('./gameScanner').deleteGamePermanently(id);
    });

    ipcMain.handle('get-hidden-games', () => require('./gameScanner').getHiddenGames());
    ipcMain.handle('restore-specific-games', (e, ids) => require('./gameScanner').restoreSpecificGames(ids));

    // فتح نافذة اختيار صورة من الجهاز
    ipcMain.handle('select-game-image', async () => {
        const { dialog } = require('electron');
        const result = await dialog.showOpenDialog(mainWindow, {
            properties: ['openFile'],
            filters: [{ name: 'Images', extensions: ['jpg', 'png', 'jpeg', 'webp'] }]
        });

        if (!result.canceled && result.filePaths.length > 0) {
            return result.filePaths[0]; // بنرجع مسار الصورة المختار
        }
        return null;
    });

    // تحديث الداتابيز بالمسار الجديد
    ipcMain.handle('update-game-image', async (e, id, path, type) => {
        return await require('./gameScanner').updateGameImage(id, path, type);
    });
    
    // ------------------------------------------
    // B. متصفح الملفات (File Explorer)
    // ------------------------------------------
    ipcMain.handle('get-drives', async () => {
        const now = Date.now();
        if (driveCache.data && (now - driveCache.lastFetched < CACHE_DURATION)) {
            return driveCache.data;
        }
        await refreshDriveCache();
        return driveCache.data || [{ path: 'C:\\', label: 'Local Disk' }];
    });


    // ==========================================
    // 📂 SMART DIRECTORY LISTER (MERGE DESKTOPS)
    // ==========================================
    ipcMain.handle('list-directories', async (event, targetPath) => {
        if (!targetPath) return [];
        let cleanPath = path.normalize(targetPath);
        if (cleanPath.length === 2 && cleanPath.endsWith(':')) cleanPath += path.sep;

        // دالة مساعدة لقراءة محتوى أي فولدر
        const readFolderContent = async (folderPath) => {
            try {
                const entries = await fs.readdir(folderPath, { withFileTypes: true });
                const allowedExtensions = ['.exe', '.lnk', '.url', '.bat'];
                
                // تحويل النتائج لمصفوفة وعمل Process لكل ملف
                const processed = await Promise.all(entries.map(async (entry) => {
                    const name = entry.name;
                    const fullPath = path.join(folderPath, name);

                    if (entry.isDirectory()) {
                        const forbidden = ['$recycle.bin', 'system volume information', 'recovery', 'windows', 'boot'];
                        if (!forbidden.includes(name.toLowerCase()) && !name.startsWith('.')) {
                            return { name, type: 'dir' };
                        }
                    } 
                    else if (entry.isFile()) {
                        const ext = path.extname(name).toLowerCase();
                        if (allowedExtensions.includes(ext)) {
                            try {
                                let iconPath = fullPath;
                                if (ext === '.lnk') {
                                    try {
                                        const shortcutDetails = shell.readShortcutLink(fullPath);
                                        if (shortcutDetails.target) iconPath = shortcutDetails.target;
                                    } catch (err) {}
                                }

                                // جلب الأيقونة
                                const icon = await app.getFileIcon(iconPath, { size: 'large' });
                                const iconData = !icon.isEmpty() ? icon.toDataURL() : null;

                                return { name, type: 'file', path: fullPath, icon: iconData };

                            } catch (e) {
                                return { name, type: 'file', path: fullPath, icon: null };
                            }
                        }
                    }
                    return null;
                }));

                return processed.filter(r => r !== null);
            } catch (e) {
                return [];
            }
        };

        // 1. اقرأ الفولدر المطلوب (الأساسي)
        let results = await readFolderContent(cleanPath);

        // 2. 🔥 السحر هنا: لو إحنا في الـ Desktop، هات كمان الـ Public Desktop
        const userDesktop = app.getPath('desktop');
        if (cleanPath.toLowerCase() === userDesktop.toLowerCase()) {
            console.log("🖥️ User is on Desktop, merging Public Desktop...");
            const publicDesktop = path.join(process.env.PUBLIC || 'C:\\Users\\Public', 'Desktop');
            const publicResults = await readFolderContent(publicDesktop);
            
            // دمج النتائج (مع منع التكرار لو فيه ملف بنفس الاسم)
            const existingNames = new Set(results.map(r => r.name.toLowerCase()));
            publicResults.forEach(item => {
                if (!existingNames.has(item.name.toLowerCase())) {
                    // نيزها بلون مختلف أو سيبها زي ما هي (اختياري)
                    results.push(item);
                }
            });
        }

        // 3. الترتيب النهائي
        return results.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
    });

    


    // ==========================================
    // C. تشغيل الألعاب (التعديل النهائي لدعم EA و Steam)
    // ==========================================
    ipcMain.on('launch-game', (event, command) => {
        console.log("🚀 Launching:", command);

        // تنظيف الكوماند
        const cleanCmd = command.replace(/"/g, '').trim();

        // 🔥 الحل السحري: تشغيل البروتوكولات (EA, Steam, Epic)
        if (cleanCmd.includes('://')) {
            // shell.openExternal هو اللي بيفتح origin2:// و steam:// صح
            shell.openExternal(cleanCmd).catch(err => {
                console.error("❌ Protocol Error:", err);
            });
            return; 
        }

        // تشغيل الشورت كتس (.lnk)
        if (cleanCmd.toLowerCase().endsWith('.lnk')) {
            shell.openPath(cleanCmd);
            return;
        }

        // تشغيل الـ EXE (لألعاب Manual و Riot)
        exec(command, (error) => {
            if (error) console.error(`❌ Exec error: ${error}`);
        });
    });

    ipcMain.handle('get-game-metadata', async (event, gameName) => await searchGame(gameName));
        // ضيف الـ handler ده جوه app.whenReady
    // في ملف main.js
    ipcMain.handle('reset-game-image', async (e, id, type) => {
        // الدالة دي بترجع دلوقتي object فيه { status, path }
        return await require('./gameScanner').resetGameImage(id, type);
    });

    ipcMain.handle('get-collections', () => colHandler.getCollections());
    ipcMain.handle('create-collection', (e, name, img) => colHandler.createCollection(name, img));
    ipcMain.handle('add-game-collection', (e, colId, gameId) => colHandler.addGameToCollection(colId, gameId));
    ipcMain.handle('remove-game-collection', (e, colId, gameId) => colHandler.removeGameFromCollection(colId, gameId));
    ipcMain.handle('delete-collection', (e, colId) => colHandler.deleteCollection(colId));


        // في جزء ipcMain.handle
    ipcMain.handle('remove-game-from-collection', async (event, collId, gameId) => {
        const { removeGameFromCollection } = require('./collectionsHandler');
        return removeGameFromCollection(collId, gameId);
    });


        // في main.js
    ipcMain.handle('get-desktop-path', () => {
        return app.getPath('desktop'); // دي دالة جاهزة في Electron بتجيب المسار الصح
    });

    ipcMain.handle('save-game-metadata', async (event, gameId, metadata) => {
        return await require('./gameScanner').updateGameMetadata(gameId, metadata);
    });

    ipcMain.handle('cache-all-assets', async (event, assets, gameId) => {
        // assets = { cover: 'url', hero: 'url', logo: 'url' }
        const results = {};
        const promises = Object.entries(assets).map(async ([type, url]) => {
            if (!url) return;
            try {
                // 🔥 1. لازم نحدد الامتداد عشان الصورة تفتح
                const cleanUrl = url.split('?')[0];
                const extension = path.extname(cleanUrl) || '.jpg';
                const filename = `${type}_${gameId}${extension}`; 

                // 2. التحميل
                const localPath = await downloadImage(url, filename);
                
                // 3. ضبط السلاش عشان يشتغل على ويندوز ولينكس
                results[type] = `file://${localPath.replace(/\\/g, '/')}`;
            } catch (e) {
                console.error(`Failed to cache ${type}:`, e);
                results[type] = url; // fallback: رجع رابط النت لو التحميل فشل
            }
        });
        
        await Promise.all(promises);
        return results;
    });

    // إنشاء النافذة
    createWindow();
    createTray();
});

ipcMain.handle('reorder-library', async (event, ids) => {
    return await require('./gameScanner').reorderLibrary(ids);
});

ipcMain.handle('reorder-collection', (e, colId, newOrder) => colHandler.reorderCollection(colId, newOrder));
ipcMain.handle('update-collection', (e, colId, name, img) => colHandler.updateCollectionDetails(colId, name, img));

app.on('window-all-closed', () => { 
    if (process.platform !== 'darwin') app.quit(); 
});


// ==========================================
// 🚀 AUTO STARTUP & SHORTCUT SETUP
// ==========================================
// ==========================================
// 🚀 AUTO STARTUP & SHORTCUT SETUP (PORTABLE FIX)
// ==========================================
// ==========================================
// 🚀 AUTO STARTUP & SHORTCUT SETUP (PORTABLE FIX)
// ==========================================
function setupWindowsIntegration() {
    // 🛑 أهم شرط: لا تفعل الـ Startup إلا لو التطبيق مبني (Packaged)
    // ده هيمنع ظهور شاشة إلكترون الافتراضية وأنت بتجرب الكود
    if (!app.isPackaged) {
        console.log("⚠️ We are in DEV mode, skipping Startup Registration to avoid 'Default Window' issue.");
        return;
    }

    const exePath = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
    const appFolder = path.dirname(exePath);

    // 1. تفعيل التشغيل التلقائي مع الويندوز
    app.setLoginItemSettings({
        openAtLogin: true,
        path: exePath, 
        args: [
            '--hidden' // 👈 دي اللي هنستلمها عشان نفتح البرنامج مخفي
        ]
    });

    // 2. إنشاء اختصار في قائمة Start Menu
    const startMenuPath = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs');
    const shortcutPath = path.join(startMenuPath, 'Baddel Launcher.lnk');

    try {
        shell.writeShortcutLink(shortcutPath, {
            target: exePath,      
            cwd: appFolder,       
            description: 'The AI Powered Gaming Hub',
            icon: exePath,        
            appUserModelId: 'com.baddel.launcher'
        });
        console.log("✅ Startup & Start Menu shortcuts updated linked to:", exePath);
    } catch (e) {
        console.error("❌ Failed to create shortcuts:", e);
    }
}