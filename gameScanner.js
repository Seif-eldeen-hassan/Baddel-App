const fs = require('fs').promises;
const fsSync = require('fs'); 
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const { searchGame } = require('./services/steamgriddb');
const crypto = require('crypto'); 
const https = require('https');
const fsOriginal = require('fs'); // عشان الـ Streams
const { app } = require('electron');

/**
 * BADDEL PRODUCTION ENGINE - V4.2 (Safe Atomic Save)
 * - Uses Atomic Writing (write temp -> rename) to prevent DB corruption.
 * - Forces save immediately on manual add.
 */

class BaddelEngine {
    constructor() {
        // 1. استرجاع تعريفات ملفات النظام (مهمة جداً لـ Epic و Riot)
        this.programData = process.env.ProgramData || 'C:\\ProgramData';
        this.appData = process.env.APPDATA || path.join(process.env.HOME, 'AppData', 'Roaming');

        // 2. توحيد مسار الداتابيز والكاش (التعديل الجديد)
        // لازم تكون ضايف: const { app } = require('electron'); فوق خالص
        this.dbFolder = app.getPath('userData'); 
        
        this.dbPath = path.join(this.dbFolder, 'games-db.json');
        
        this.officialPaths = new Set(); 
        this.dbCache = []; 
        
        this.initDatabase();
    }

        // استبدل الدالة القديمة بدي
    generateStableId(game) {
        // الترتيب الصح: الأمر (المسار الكامل للملف) -> ثم الاسم
        // شيلنا game.path عشان ده بيعمل مشاكل لو لعبتين في نفس الفولدر
        const str = (game.command || game.name).toLowerCase().replace(/"/g, '').trim();
        return crypto.createHash('md5').update(str).digest('hex').substring(0, 16);
    }

    // ==========================================
    // DATABASE SYSTEM (ATOMIC SAVE)
    // ==========================================

    initDatabase() {
        try {
            if (!fsSync.existsSync(this.dbFolder)) {
                fsSync.mkdirSync(this.dbFolder, { recursive: true });
            }
            if (!fsSync.existsSync(this.dbPath)) {
                fsSync.writeFileSync(this.dbPath, JSON.stringify([], null, 2), 'utf8');
            }
            
            const data = fsSync.readFileSync(this.dbPath, 'utf8');
            try {
                this.dbCache = JSON.parse(data);
                console.log(`[DB] Loaded ${this.dbCache.length} games.`);
            } catch (parseErr) {
                console.error("[DB] Corrupted file, resetting.");
                this.dbCache = [];
                this.saveDatabase();
            }
        } catch (err) {
            console.error("[DB] Init Error:", err);
            this.dbCache = [];
        }
    }

    // 🔥 التعديل: الحفظ الآمن المحسن للويندوز
    saveDatabase() {
        try {
            console.log("[DB] Starting save attempt...");
            console.log("[DB] Target path:", this.dbPath);
            console.log("[DB] Games count to save:", this.dbCache.length);
            // كتابة مباشرة بدون أي تعقيد atomic
            fsSync.writeFileSync(this.dbPath, JSON.stringify(this.dbCache, null, 2), 'utf8');
            
            console.log(`[DB] Saved ${this.dbCache.length} games successfully.`);
            console.log(`[DB] Path: ${this.dbPath}`); // عشان تتأكد إنه بيحفظ في المكان الصح
            
        } catch (err) {
            console.error("[DB] CRITICAL ERROR: Failed to save database:", err);
            console.error("[DB] Path attempted:", this.dbPath);
            console.error("[DB] Current cache length:", this.dbCache.length);
            
            // محاولة أخيرة: جرب مكان بديل مؤقت عشان تعرف المشكلة
            try {
                const backupPath = path.join(path.dirname(this.dbPath), 'games-db-backup.json');
                fsSync.writeFileSync(backupPath, JSON.stringify(this.dbCache, null, 2), 'utf8');
                console.log("[DB] Emergency backup saved to:", backupPath);
            } catch (backupErr) {
                console.error("[DB] Even backup failed:", backupErr);
            }
        }
    }

    // ==========================================
    // UPSERT (FIXED: Protects User Name)
    // ==========================================
    // استبدل الدالة القديمة بدي
    // ==========================================
    // UPSERT (FIXED: Saves Hero & Logo)
    // ==========================================
    async upsertGame(game) {
        // 1. حساب ID لو مش موجود
        if (!game.id) {
            game.id = this.generateStableId(game);
        }

        // 2. البحث
        const index = this.dbCache.findIndex(g => 
            g.id === game.id || 
            (g.command && game.command && 
            g.command.replace(/"/g, '').toLowerCase().trim() === game.command.replace(/"/g, '').toLowerCase().trim())
        );
        
        if (index > -1) {
            // تحديث البيانات
            const existingGame = this.dbCache[index];
            
            // 🔥 المنطق الجديد: بنحافظ على الـ Default لو موجود، لو مش موجود بنعتبر الصورة الحالية هي الديفولت
            const defImg = existingGame.defaultImage || existingGame.image || game.image;
            const defHero = existingGame.defaultHero || existingGame.heroImage || game.heroImage;
            const defLogo = existingGame.defaultLogo || existingGame.logo || game.logo;

            this.dbCache[index] = {
                ...existingGame, 
                // تحديث البيانات الأساسية
                command: game.command || existingGame.command,
                path: game.path || existingGame.path,
                platform: game.platform || existingGame.platform,
                
                // تحديث الصور الحالية (اللي بتظهر لليوزر)
                image: game.image || existingGame.image,
                heroImage: game.heroImage || existingGame.heroImage,
                logo: game.logo || existingGame.logo,
                
                // 🔥 حفظ النسخ الأصلية (Backup) لاستخدامها في الـ Reset
                defaultImage: defImg,
                defaultHero: defHero,
                defaultLogo: defLogo,
                
                id: existingGame.id 
            };
        } else {
            // إضافة جديدة
            this.dbCache.push({
                addedAt: new Date().toISOString(),
                score: 100,
                isHidden: false,
                heroImage: null,
                logo: null,
                ...game,
                // 🔥 في الإضافة الجديدة، الصور دي هي الديفولت
                defaultImage: game.image || null,
                defaultHero: game.heroImage || null,
                defaultLogo: game.logo || null
            });
        }
    }

    async removeGame(gameNameOrPath) {
        this.dbCache = this.dbCache.filter(g => 
            g.path.toLowerCase() !== gameNameOrPath.toLowerCase() && 
            g.name.toLowerCase() !== gameNameOrPath.toLowerCase()
        );
        this.saveDatabase();
    }

    // ==========================================
    // ✅ UPDATE IMAGE (Fixed & Debugged)
    // ==========================================
    // ==========================================
    // ✅ UPDATE IMAGE (Debug Version)
    // ==========================================
    async updateGameImage(gameId, newImagePath, type = 'cover') {
        const index = this.dbCache.findIndex(g => String(g.id) === String(gameId));
        
        if (index > -1) {
            let finalPath = newImagePath;
            // تأكد إن المسار فيه file:// لو هو مسار محلي
            if (newImagePath && !newImagePath.startsWith('http') && !newImagePath.startsWith('file://')) {
                finalPath = `file://${newImagePath}`;
            }

            // 🔥 هنا اللوجيك الجديد: بنشوف النوع إيه ونحدث الحقل بتاعه
            if (type === 'hero') {
                this.dbCache[index].heroImage = finalPath;
            } else if (type === 'logo') {
                this.dbCache[index].logo = finalPath;
            } else {
                // الافتراضي cover
                this.dbCache[index].image = finalPath; 
            }

            this.saveDatabase();
            return { status: 'success', path: finalPath, type };
        }
        return { status: 'error', message: 'Game not found' };
    }


    // ==========================================
    // UNHIDE / RESTORE ALL
    // ==========================================
    async unhideAllGames() {
        let count = 0;
        this.dbCache.forEach(g => {
            if (g.isHidden) {
                g.isHidden = false;
                count++;
            }
        });
        
        if (count > 0) {
            this.saveDatabase();
            return { status: 'success', restoredCount: count };
        }
        return { status: 'no_hidden' };
    }


    // ==========================================
    // RENAME & REMOVE (ID Based)
    // ==========================================

    async renameGame(gameId, newName) {
        const index = this.dbCache.findIndex(g => g.id === gameId);
        if (index > -1) {
            this.dbCache[index].name = newName;
            this.saveDatabase();
            return { status: 'success', newName: newName };
        }
        return { status: 'error', message: 'Game not found' };
    }

    // ==========================================
    // REMOVE GAME (Fix Type Mismatch)
    // ==========================================
    async removeGame(gameId) {
        // بدل ما نمسح السطر، هندور عليه ونخليه مخفي
        const index = this.dbCache.findIndex(g => String(g.id) === String(gameId));
        
        if (index > -1) {
            // 🔥 التعديل هنا: مش بنمسح، بنضيف خاصية isHidden
            this.dbCache[index].isHidden = true;
            this.saveDatabase();
            return { status: 'success' };
        }
        
        return { status: 'error', message: 'Game not found' };
    }

    // دالة مساعدة لتحميل الصور وحفظها في الكاش
   // دالة مساعدة لتحميل الصور وحفظها في الكاش (بنسخة Timeout صارمة)
    async downloadToCache(url, gameId, type) {
        if (!url || !url.startsWith('http')) return null;
        
        const cacheDir = path.join(this.dbFolder, 'image_cache'); 
        if (!fsOriginal.existsSync(cacheDir)) {
            fsOriginal.mkdirSync(cacheDir, { recursive: true });
        }

        const ext = path.extname(url.split('?')[0]) || '.jpg';
        const filename = `${type}_${gameId}${ext}`;
        const filePath = path.join(cacheDir, filename);

        return new Promise((resolve) => {
            const file = fsOriginal.createWriteStream(filePath);
            
            const request = https.get(url, (response) => {
                if (response.statusCode !== 200) {
                    file.close();
                    fsOriginal.unlink(filePath, () => {}); // امسح الملف الفاضي
                    resolve(null);
                    return;
                }
                response.pipe(file);
                
                file.on('finish', () => {
                    file.close();
                    resolve(`file://${filePath.replace(/\\/g, '/')}`);
                });
            });

            // 🔥 التعديل هنا: مهلة 7 ثواني بالظبط
            // لو الصورة منزلتش في 7 ثواني، اقطع الاتصال فوراً
            request.setTimeout(7000, () => {
                console.log(`[Timeout] Aborting slow download for ${type} of ${gameId}`);
                request.destroy(); // اقتل الطلب
                file.close();
                fsOriginal.unlink(filePath, () => {}); // نظف وراك
                resolve(null); // كمل عادي ولا كأن حاجة حصلت
            });

            request.on('error', (err) => {
                file.close();
                fsOriginal.unlink(filePath, () => {});
                resolve(null);
            });
        });
    }
    // ==========================================
    // MANUAL ADD (Robust Save & ID)
    // ==========================================
    // ==========================================
    // ⚡ MANUAL ADD (Robust Search + Background Download)
    // ==========================================
    async addManualGame(exePath, customName = null) {
        try {
            // 1. التأكد من الملف
            const stats = await fs.stat(exePath);
            if (!stats.isFile()) return { status: 'error', message: 'File not found' };

            const exeName = path.parse(exePath).name.replace(/[-_]/g, ' ').trim();
            const parentFolderName = path.basename(path.dirname(exePath)).replace(/[-_]/g, ' ').trim();

            // 2. استراتيجية البحث القوية (زي ما أنت عايز بالظبط)
            // هندور في الـ 3 مراحل عشان نضمن أفضل نتيجة
            const searchSteps = [
                { name: exeName, source: 'EXE Name' },
                { name: customName, source: 'User Input' },
                { name: parentFolderName, source: 'Folder Name' }
            ].filter(step => step.name && step.name.trim() !== "");

            console.log(`🔍 [Manual Add] Starting robust search for: ${exePath}`);

            let finalMetadata = null;
            let finalUsedName = customName || exeName; // الاسم الافتراضي

            // تنفيذ البحث (هننتظره عشان دقة البيانات أهم)
            for (const step of searchSteps) {
                try {
                    console.log(`Searching via ${step.source}: ${step.name}`);
                    const metadata = await searchGame(step.name);
                    if (metadata && metadata.cover) {
                        finalMetadata = metadata;
                        // لو اليوزر مش كاتب اسم مخصص، نستخدم الاسم الرسمي اللي لقيناه
                        if (!customName) finalUsedName = step.name; 
                        console.log(`✅ Found metadata via ${step.source}`);
                        break; 
                    }
                } catch (e) { console.log(`Search skip: ${step.name}`); }
            }

            // 3. التحقق من التكرار
            const normalizedNewPath = path.normalize(exePath).toLowerCase().trim();
            const existingIndex = this.dbCache.findIndex(game => {
                const storedCmd = (game.command || "").replace(/"/g, '').trim().toLowerCase();
                return path.normalize(storedCmd) === normalizedNewPath;
            });

            if (existingIndex > -1) {
                // اللعبة موجودة بالفعل
                const existingGame = this.dbCache[existingIndex];
                
                // لو كانت مخفية (في سلة المهملات)، رجعها للحياة
                if (existingGame.isHidden) {
                    existingGame.isHidden = false;
                    this.saveDatabase();
                }
                
                // 🔥 التعديل السحري:
                // بدل ما نرجع 'exists' ونضايق اليوزر، هنرجع 'success' ونبعت بيانات اللعبة الموجودة
                // كأننا ضفناها جديد بالظبط، فاليوزر هيلاقيها ظهرت قدامه
                return { status: 'success', game: existingGame };
            }

            // 4. توليد ID ثابت
            const tempIdObj = { command: `"${exePath}"`, name: customName || exeName };
            const stableId = this.generateStableId(tempIdObj);

            // 5. 🔥 الحفظ الفوري بروابط النت (عشان الزرار يفك بسرعة)
            const newGame = {
                id: stableId,
                name: finalUsedName,
                command: `"${exePath}"`,
                platform: 'Manual',
                
                // هنحط روابط النت مؤقتاً عشان تظهر لليوزر فوراً
                image: finalMetadata ? finalMetadata.cover : null,
                heroImage: finalMetadata ? finalMetadata.hero : null,
                logo: finalMetadata ? finalMetadata.logo : null,
                
                score: 100,
                isHidden: false,
                addedAt: new Date().toISOString()
            };

            // حفظ في الداتابيز
            await this.upsertGame(newGame);
            this.saveDatabase();

            // 6. 🚀 تشغيل تحميل الصور في الخلفية (من غير await)
            if (finalMetadata) {
                console.log("⬇️ [Background] Starting image download...");
                this.backgroundDownload(finalMetadata, stableId);
            }

            // رجع النتيجة فوراً والتحميل شغال ورا
            return { status: 'success', game: newGame };

        } catch (err) {
            console.error(err);
            return { status: 'error', message: err.message };
        }
    }

    // دالة مساعدة للتحميل في الخلفية وتحديث الداتابيز بصمت
    async backgroundDownload(metadata, gameId) {
        try {
            // بنحاول نحمل الصور (بياخد وقته هنا براحته)
            const [localCover, localHero, localLogo] = await Promise.all([
                metadata.cover ? this.downloadToCache(metadata.cover, gameId, 'cover') : null,
                metadata.hero ? this.downloadToCache(metadata.hero, gameId, 'hero') : null,
                metadata.logo ? this.downloadToCache(metadata.logo, gameId, 'logo') : null
            ]);

            // لو التحميل نجح، حدث الداتابيز بالمسارات المحلية (file://)
            if (localCover || localHero || localLogo) {
                await this.updateGameMetadata(gameId, {
                    cover: localCover || metadata.cover,
                    hero: localHero || metadata.hero,
                    logo: localLogo || metadata.logo
                });
                console.log(`✅ [Background] Images saved locally for ${gameId}`);
            }
        } catch (e) {
            console.error("Background download failed:", e);
        }
    }
    

    // ==========================================
    // OFFICIAL GAMES SCANNERS
    // ==========================================

    async getOfficialGames() {
        const official = [
            await this.getSteamGames(),
            await this.getEpicGames(),
            await this.getRiotGames(),
            await this.getUbisoftGames(),
            await this.getEAGames(),
            await this.getXboxGames()
        ];
        const flatList = official.flat();
        flatList.forEach(g => { if(g.path) this.officialPaths.add(g.path.toLowerCase()); });
        return flatList;
    }

    async getSteamGames() {
        const games = [];
        try {
            const cmd = `Get-ItemProperty 'HKCU:\\Software\\Valve\\Steam' | Select-Object -ExpandProperty SteamPath`;
            const { stdout } = await execAsync(`powershell -command "${cmd}"`);
            const steamPath = stdout.trim();
            if (!steamPath) return [];

            const vdfPath = path.join(steamPath, 'steamapps', 'libraryfolders.vdf');
            const content = await fs.readFile(vdfPath, 'utf8');
            const libraryMatches = content.match(/"path"\s+"([^"]+)"/g);
            let libraries = libraryMatches ? libraryMatches.map(m => m.match(/"path"\s+"([^"]+)"/)[1].replace(/\\\\/g, '\\')) : [steamPath];
            libraries = [...new Set(libraries)]; 

            for (const lib of libraries) {
                const appsPath = path.join(lib, 'steamapps');
                try {
                    const files = await fs.readdir(appsPath);
                    for (const file of files) {
                        if (file.startsWith('appmanifest_') && file.endsWith('.acf')) {
                            const acfPath = path.join(appsPath, file);
                            const acf = await fs.readFile(acfPath, 'utf8');

                            // استخراج البيانات باستخدام Regex أكثر مرونة للـ Indie Games
                            const name = acf.match(/"name"\s+"([^"]+)"/i)?.[1];
                            const id = acf.match(/"appid"\s+"(\d+)"/i)?.[1];
                            const dir = acf.match(/"installdir"\s+"([^"]+)"/i)?.[1];
                            const stateFlags = acf.match(/"StateFlags"\s+"(\d+)"/i)?.[1];

                            // 🔥 التعديل الجوهري:
                            // بنقبل اللعبة لو الحالة (4 أو 6 أو 1026 أو حتى 1030) 
                            // طالما الاسم موجود ومش "Steamworks Common"
                            if (name && id && !name.includes("Steamworks")) {
                                const gamePath = path.join(appsPath, 'common', dir || "");
                                
                                games.push({
                                    id: `steam-${id}`,
                                    name: name,
                                    platform: 'Steam',
                                    path: gamePath,
                                    command: `steam://run/${id}`,
                                    score: 100,
                                    // بنحتفظ بالحالة عشان لو حبيت تعرض "Update" في الـ UI
                                    needsUpdate: stateFlags !== "4" 
                                });
                            }
                        }
                    }
                } catch (e) {}
            }
        } catch (e) {
            console.error("Steam Scan Error:", e);
        }
        return games;
    }

    async getEpicGames() {
        console.log("🚀 [Epic Scan] Starting Deep Manifest Scan...");
        const games = [];
        const root = path.join(this.programData, 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests');

        try {
            if (!fsSync.existsSync(root)) return games;

            const files = await fs.readdir(root);
            for (const file of files) {
                if (file.endsWith('.item')) {
                    const data = JSON.parse(await fs.readFile(path.join(root, file), 'utf8'));

                    const displayName = data.DisplayName;
                    const installLocation = data.InstallLocation; // المسار اللي اللعبة مفروض تكون فيه

                    // 🔥 التعديل السحري هنا:
                    // لو الفولدر بتاع اللعبة مش موجود، متضفش اللعبة للمكتبة
                    if (!installLocation || !fsSync.existsSync(installLocation)) {
                        console.log(`⚠️ [Epic Skip] ${displayName} is uninstalled (folder not found).`);
                        continue; 
                    }

                    const namespace = data.CatalogNamespace;
                    const itemId = data.CatalogItemId;
                    const appName = data.AppName;

                    if (displayName && namespace && itemId) {
                        const epicCommand = `com.epicgames.launcher://apps/${namespace}%3A${itemId}%3A${appName}?action=launch&silent=true`;

                        games.push({
                            id: `epic-${appName}`,
                            name: displayName,
                            platform: 'Epic Games',
                            path: installLocation,
                            command: epicCommand,
                            score: 100
                        });
                    }
                }
            }
        } catch (err) {
            console.error("Epic Scan Error:", err);
        }
        return games;
    }

    async getRiotGames() {
        const games = [];
        let basePath = null;
        let clientExe = null;
        const programDataPath = path.join(this.programData, 'Riot Games', 'RiotClientInstalls.json');
        try {
            const data = JSON.parse(await fs.readFile(programDataPath, 'utf8'));
            if (data.rc_default) clientExe = data.rc_default.replace(/\\\\/g, '\\');
            if (data.associated_client && typeof data.associated_client === 'object') {
                for (const key in data.associated_client) {
                    if (key.includes('valorant')) {
                        const valorantLivePath = data.associated_client[key].replace(/\\\\/g, '\\');
                        basePath = path.dirname(path.dirname(valorantLivePath)); 
                    }
                }
            }
            if (clientExe && !basePath) basePath = path.dirname(path.dirname(clientExe));
        } catch (err) {}
        if (basePath) {
            try {
                const dirs = await fs.readdir(basePath, { withFileTypes: true });
                for (const dir of dirs) {
                    if (!dir.isDirectory()) continue;
                    const folderName = dir.name.toLowerCase();
                    let gameName = '', productId = '';
                    if (folderName === 'valorant') { gameName = 'VALORANT'; productId = 'valorant'; } 
                    else if (folderName === 'league of legends') { gameName = 'League of Legends'; productId = 'league_of_legends'; } 
                    else continue;
                    const gamePath = path.join(basePath, dir.name);
                    let command = clientExe ? `"${clientExe}" --launch-product=${productId} --launch-patchline=live` : `explorer.exe "${gamePath}"`;
                    games.push({ name: gameName, platform: 'Riot Games', path: gamePath, command: command, score: 100 });
                }
            } catch (err) {}
        }
        if (games.length === 0) {
            let drives = ['C:\\'];
            try {
                const cmd = 'powershell -command "Get-PSDrive -PSProvider FileSystem | Select-Object -ExpandProperty Name"';
                const { stdout } = await execAsync(cmd);
                drives = stdout.split(/\r?\n/).filter(d => d.trim().length > 0).map(d => d.trim() + ':\\');
            } catch {}
            for (const drive of drives) {
                const possibleBase = path.join(drive, 'Riot Games');
                try {
                    const dirs = await fs.readdir(possibleBase, { withFileTypes: true });
                    const clientExeFallback = path.join(possibleBase, 'Riot Client', 'RiotClientServices.exe');
                    let hasClient = false;
                    try { await fs.access(clientExeFallback); hasClient = true; } catch {}
                    for (const dir of dirs) {
                        if (!dir.isDirectory()) continue;
                        const folderName = dir.name.toLowerCase();
                        if (folderName === 'valorant' || folderName === 'league of legends') {
                            const gameName = folderName === 'valorant' ? 'VALORANT' : 'League of Legends';
                            const productId = folderName === 'valorant' ? 'valorant' : 'league_of_legends';
                            const gamePath = path.join(possibleBase, dir.name);
                            const command = hasClient ? `"${clientExeFallback}" --launch-product=${productId} --launch-patchline=live` : `explorer.exe "${gamePath}"`;
                            games.push({ name: gameName, platform: 'Riot Games', path: gamePath, command: command, score: 100 });
                        }
                    }
                    if (games.length > 0) break;
                } catch {}
            }
        }
        return games;
    }

    // ==========================================
    // 🦅 UBISOFT CONNECT SCANNER (PRO - Correct Names)
    // ==========================================
    async getUbisoftGames() {
        console.log("🚀 [Ubisoft Scan] Starting Registry Scan...");
        const games = [];
        
        // 🔥 التغيير الجوهري: بندور في مفاتيح الـ Uninstall لأن فيها الاسم الرسمي (DisplayName)
        // المفاتيح دي دايماً بتكون بصيغة: Uplay Install <ID>
        const cmd = `Get-ItemProperty 'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Uplay Install *' -ErrorAction SilentlyContinue | Select-Object DisplayName, InstallLocation, PSChildName | ConvertTo-Json`;

        try {
            const { stdout } = await execAsync(`powershell -command "${cmd}"`);
            
            if (!stdout || stdout.trim() === "") return games;

            let installs = JSON.parse(stdout);
            if (!Array.isArray(installs)) installs = [installs];

            installs.forEach(g => {
                // تأكد أن المسار موجود والاسم موجود
                if (g.InstallLocation && g.DisplayName) {
                    
                    // استخراج الـ ID من اسم المفتاح (Uplay Install 1234 -> 1234)
                    // PSChildName بيرجع اسم المفتاح الأخير
                    const gameId = g.PSChildName.replace('Uplay Install ', '').trim();

                    // تنظيف المسار
                    const installPath = g.InstallLocation.replace(/"/g, '').replace(/\\\\/g, '\\');

                    // التأكد من أن الفولدر لسه موجود (عشان لو ممسوحة غلط من الريجستري)
                    // (خطوة اختيارية بس بتزود الأمان)
                    // if (!fsSync.existsSync(installPath)) return; 

                    // جوه دالة getUbisoftGames.. جرب تغير الـ command لـ uplay
                    games.push({ 
                        name: g.DisplayName, 
                        platform: 'Ubisoft Connect', 
                        path: installPath, 
                        command: `uplay://launch/${gameId}/0`, // جرب uplay بدل ubisoftconnect
                        score: 100 
                    });
                }
            });

        } catch (err) {
            console.error("[Ubisoft Scan] Error:", err);
        }
        
        return games;
    }

async getEAGames() {
    console.log("🔍 [EA Scan] Starting Deep Scan for real OfferIDs...");
    const games = [];
    const manifestsDir = path.join(process.env.ProgramData, 'EA Desktop', 'InstallData');

    if (fsSync.existsSync(manifestsDir)) {
        try {
            const folders = await fs.readdir(manifestsDir, { withFileTypes: true });
            for (const folder of folders) {
                if (!folder.isDirectory()) continue;

                const gameFolderPath = path.join(manifestsDir, folder.name);
                const subFiles = await fs.readdir(gameFolderPath);
                
                // 1. بندور على الفولدر اللي بيبدأ بـ "base-" لأنه هو اللي فيه الـ ID الحقيقي
                const baseFolder = subFiles.find(f => f.startsWith('base-'));
                let realOfferId = null;

                if (baseFolder) {
                    // base-Origin.SFT.50.0001545 -> Origin.SFT.50.0001545
                    realOfferId = baseFolder.replace('base-', '');
                }

                // 2. قراءة ملف الـ JSON عشان نجيب الاسم النظيف
                const jsonFile = subFiles.find(f => f.endsWith('.json'));
                let gameName = folder.name; // اسم افتراضي

                if (jsonFile) {
                    const data = JSON.parse(await fs.readFile(path.join(gameFolderPath, jsonFile), 'utf8'));
                    gameName = data.title || data.Title || gameName;
                    // لو ملقتش الـ base- folder، خد الـ offerId من ملف الـ JSON كحل بديل
                    if (!realOfferId) realOfferId = data.offerId || data.contentIds?.[0];
                }

                if (realOfferId) {
                    console.log(`✅ [EA Found] ${gameName} with ID: ${realOfferId}`);
                    games.push({
                        id: `ea-${realOfferId}`,
                        name: gameName,
                        platform: 'EA App',
                        path: "", // المسار مش ضروري للتشغيل عبر البروتوكول
                        command: `origin2://game/launch?offerIds=${realOfferId}`,
                        score: 95
                    });
                }
            }
        } catch (err) {
            console.error("EA Manifest Error:", err);
        }
    }
    return games;
}
    // ==========================================
    // 🛡️ XBOX / STORE SCANNER (BLACKLIST + IMAGE VERIFICATION)
    // ==========================================
    async getXboxGames() {
        console.log("🚀 [Xbox Scan] Starting Scan (Phase 1: Blacklist)..."); 
        
        // دي القائمة المبدئية اللي هنجمع فيها اللي يعدي من الـ Blacklist
        const candidates = [];
        const finalGames = [];

        const psCommand = `Get-AppxPackage | Where-Object { $_.IsFramework -eq $false -and $_.SignatureKind -eq 'Store' -and $_.InstallLocation } | Select-Object Name, PackageFamilyName, InstallLocation | ConvertTo-Json`;

        try {
            const { stdout } = await execAsync(`powershell -command "${psCommand}"`, { maxBuffer: 1024 * 1024 * 50 });
            if (!stdout || stdout.trim() === "") return [];

            let apps = JSON.parse(stdout);
            if (!Array.isArray(apps)) apps = [apps];

            // ⛔ 1. القائمة السوداء (Blacklist) - محدثة
            const bloatKeywords = [
                // 1. Specific Junk
                'Soundcloud', 'Scratch', 'DevHome', 'Clipchamp', 'AURACreator', 'ArmouryCrate', 
                'XLSXEditor', 'HEICConverter', 'CommunicationsApps', 'Sibist', 'smallapp',
                
                'Ink', 'Handwriting', 'OneConnect', 'Connect', 'Streaming', 'XboxApp', 
                'XboxGaming', 'Identity', 'Insider', 'OperatingEnvironment', 'XboxOne',
                
                // 2. System & Core
                'Overlay', 'Service', 'Provider', 'Runtime', 'Component', 'Plugin', 'Extension', 
                'Agent', 'Library', 'Middleware', 'Bios', 'Driver', 'Shell', 'Experience',
                'Host', 'Auth', 'Secure', 'Native', 'Telemetry', 'Console', 'Dialog',
                'Compatibility', 'Enhancement', 'Source', 'Broker', 'UI', 'Xaml', 'Health',
                'bgTask', 'Background', 'Task', 'Manager', 'Setting', 'Config',
                
                // 3. Microsoft Apps
                'Cortana', 'Copilot', 'Edge', 'OneDrive', 'Teams', 'Skype', 'Office', 'Outlook', 
                'OneNote', 'PowerAutomate', 'ToDo', 'Whiteboard', 'Tips', 'Feedback', 'Help',
                'Calculator', 'Alarms', 'Maps', 'Camera', 'Photos', 'SoundRecorder', 'Paint',
                'Terminal', 'Notepad', 'StickyNotes', 'Phone', 'People', 'Wallet', 'News', 'Weather',
                'Store', 'Installer', 'Purchase', 'Family', 'CrossDevice', 'Winget', 'Bing',
                'Zune', 'Sketch', 'Screen', 'Media', 'Control', 'GamingApp', 
                
                // 4. Social & Media
                'Instagram', 'Facebook', 'Messenger', 'WhatsApp', 'Telegram', 'Twitter', 'XCorp', 
                'TikTok', 'Snapchat', 'Reddit', 'Pinterest', 'LinkedIn', 'Discord', 'Slack', 'Zoom',
                'Netflix', 'Spotify', 'Disney', 'Hulu', 'Prime', 'AmazonVideo', 'iTunes', 'AppleMusic',
                'VLC', 'Crunchyroll', 'Twitch', 'Youtube', 'Pandora', 'Deezer', 'Tidal',
                
                // 5. Tools
                'Adobe', 'Photoshop', 'Lightroom', 'Canva', 'Picsart', 'Dolby', 'Realtek', 'NVIDIA', 
                'Intel', 'AMD', 'HP', 'Dell', 'Lenovo', 'Asus', 'Acer', 'MSI', 'Razer', 
                'Translucent', 'Wallpaper', 'Studio', 'Obs', 'Audacity', 'WinRAR', 'Zip'
            ];

            // 🔥 ملحوظة: لو مش عايز Solitaire تظهر، شيلها من القائمة دي:
            const gameExceptions = ['Minesweeper', 'Minecraft', 'Roblox', 'Solitaire'];

            // --- PHASE 1: BLACKLIST FILTERING ---
            apps.forEach(app => {
                const name = app.Name;
                const lowerName = name.toLowerCase();

                // استثناءات
                const isException = gameExceptions.some(ex => lowerName.includes(ex.toLowerCase()));

                if (!isException) {
                    // فلتر القائمة السوداء
                    if (bloatKeywords.some(bloat => lowerName.includes(bloat.toLowerCase()))) return;
                    // فلتر كلمات النظام
                    if (lowerName.includes("client") || lowerName.includes("overlay") || lowerName.includes("service")) return;
                }

                // تنظيف الاسم
                let friendlyName = name.replace(/Microsoft\./i, '').replace(/\./g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
                const launchCommand = `explorer.exe shell:AppsFolder\\${app.PackageFamilyName}!App`;

                // ضيفها للمرشحين (لسه مش هنعتمدها)
                candidates.push({
                    name: friendlyName,
                    platform: 'Xbox / Store',
                    path: app.InstallLocation,
                    command: launchCommand,
                    score: 90
                });
            });

            console.log(`[Xbox Scan] Phase 1 complete. Found ${candidates.length} candidates. Starting Phase 2 (Image Check)...`);

            // --- PHASE 2: IMAGE VERIFICATION (The Filter You Wanted) ---
            // هنلف على المرشحين ونسأل الـ API هل ليهم صورة؟
            // بنستخدم for...of عشان نستنى كل واحدة (أبطأ شوية بس أأمن عشان الـ Rate Limit)
            const delay = ms => new Promise(res => setTimeout(res, ms));

            // --- داخل getXboxGames (Phase 2) ---
            for (const candidate of candidates) {
                try {
                    // 1. استثناءات للألعاب المعروفة عشان منسألش الـ API ونوفر وقت
                    const isException = gameExceptions.some(ex => candidate.name.toLowerCase().includes(ex.toLowerCase()));
                    if (isException) {
                        finalGames.push(candidate);
                        continue;
                    }
            
                    // 2. تأخير بسيط 300ms عشان نتجنب الـ Network Error
                    await delay(300); 
            
                    // 3. محاولة جلب البيانات
                    const metadata = await searchGame(candidate.name);
            
                    if (metadata && metadata.cover) {
                        candidate.image = metadata.cover; 
                        candidate.heroImage = metadata.hero;
                        finalGames.push(candidate);
                        console.log(`✅ Verified: ${candidate.name}`);
                    } else {
                        console.log(`🗑️ Rejected (No Cover): ${candidate.name}`);
                    }
            
                } catch (e) {
                    // 🛑 التعديل المهم: لو حصل Network Error، متضيفش اللعبة (Clipchamp مثلاً هتطير هنا)
                    console.error(`❌ Network Error for ${candidate.name}:`, e.message);
                }
            }

        } catch (err) {
            console.error("[Xbox Scan] Error:", err);
        }
        
        console.log(`[Xbox Scan] Final Count: ${finalGames.length}`);
        return finalGames;
    }


    // ==========================================
    // GLOBAL SCAN & SYNC
    // ==========================================

    async startGlobalScan() {
        // 1. هات كل الألعاب من المصادر
        const official = await this.getOfficialGames();
        
        // 2. فلترة التكرار (Unique Map)
        // الهدف: لو اللعبة مكررة بالاسم، ناخد نسخة واحدة بس قبل ما نبدأ شغل
        const uniqueMap = new Map();
        for (const game of official) {
            const nameKey = game.name.toLowerCase().trim();
            // لو الاسم مش موجود ضيفه، لو موجود خلاص (كده منعنا تكرار الأسماء)
            if (!uniqueMap.has(nameKey)) uniqueMap.set(nameKey, game);
        }
        const uniqueGamesList = Array.from(uniqueMap.values());

        // 3. اللوب الرئيسي (Upsert)
        // بنلف على القائمة النظيفة بس
        for (const game of uniqueGamesList) {
            try {
                // لو اللعبة Steam، بنثق في وجودها حتى لو المسار عليه Lock حالياً
                if (game.platform === 'Steam') {
                    await this.upsertGame(game);
                    continue;
                }

                // للألعاب التانية، نتأكد إن المسار موجود
                if (game.path && game.path.trim() !== "") {
                    await fs.access(game.path).catch(() => {
                        // لو المسار مش شغال، ممكن نقرر منضيفهاش، أو نضيفها بس نخليها تحتاج إصلاح
                        // في حالتنا هنا بنعديها لو Upsert فشل، بس upsertGame هيتصرف
                    });
                }
                
                await this.upsertGame(game);
            } catch (err) {
                console.log(`⚠️ Skipping ${game.name} - Path access issue.`);
            }
        }

        // 4. حفظ نهائي مرة واحدة
        this.saveDatabase();
        return this.dbCache;
    }
    
    getStoredGames() {
        // 🔥 التعديل هنا: رجع الألعاب اللي مش مخفية بس
        return this.dbCache.filter(g => !g.isHidden);
    }
    // ==========================================
    // RECYCLE BIN LOGIC
    // ==========================================
    
    // 1. هات الألعاب المخفية بس
    getHiddenGames() {
        return this.dbCache.filter(g => g.isHidden);
    }

    // 2. استرجاع مجموعة ألعاب محددة (List of IDs)
    async restoreSpecificGames(gameIds) {
        let count = 0;
        this.dbCache.forEach(g => {
            // لو الـ ID موجود في القائمة اللي اتبعتت، شيل الإخفاء
            if (gameIds.includes(String(g.id))) {
                g.isHidden = false;
                count++;
            }
        });
        
        if (count > 0) {
            this.saveDatabase();
            return { status: 'success', count };
        }
        return { status: 'error', message: 'Nothing restored' };
    }

    // ==========================================
    // HARD DELETE (For Manual Games Only)
    // ==========================================
    // ==========================================
    // HARD DELETE (For Manual Games Only)
    // ==========================================
    async deleteGamePermanently(gameId) {
        const initialLength = this.dbCache.length;
        
        // 1. فلتر واحذف اللي عنده الـ ID ده نهائياً من الداتابيز
        this.dbCache = this.dbCache.filter(g => String(g.id) !== String(gameId));
        
        if (this.dbCache.length < initialLength) {
            // 2. 🔥 نظف الصور من الهارد
            this.deleteGameImages(gameId);

            // 3. احفظ الداتابيز الجديدة
            this.saveDatabase();
            return { status: 'success' };
        }
        return { status: 'error', message: 'Game not found' };
    }

   async resetGameImage(gameId, type = 'cover') {
        const index = this.dbCache.findIndex(g => String(g.id) === String(gameId));
        
        if (index > -1) {
            const game = this.dbCache[index];
            let restoredPath = null;

            if (type === 'hero') {
                // رجع الديفولت المحفوظ، أو حاول تخمن مكانه في الكاش
                restoredPath = game.defaultHero || this.findInCache(gameId, 'hero');
                game.heroImage = restoredPath;
            } else if (type === 'logo') {
                restoredPath = game.defaultLogo || this.findInCache(gameId, 'logo');
                game.logo = restoredPath;
            } else { // cover
                restoredPath = game.defaultImage || this.findInCache(gameId, 'cover');
                game.image = restoredPath;
            }
            
            this.saveDatabase();
            // بنرجع المسار عشان الفرونت إند يعرضه فوراً
            return { status: 'success', type, path: restoredPath };
        }
        return { status: 'error', message: 'Game not found' };
    }

    findInCache(gameId, type) {
        try {
            const cacheDir = path.join(this.dbFolder, 'image_cache');
            if (!fsSync.existsSync(cacheDir)) return null;
            
            const files = fsSync.readdirSync(cacheDir);
            // دور على ملف بيبدأ بـ cover_GAMEID
            const found = files.find(f => f.startsWith(`${type}_${gameId}`));
            
            if (found) {
                return `file://${path.join(cacheDir, found).replace(/\\/g, '/')}`;
            }
        } catch (e) { return null; }
        return null;
    }


    // ==========================================
    // ✅ SAVE METADATA (To fix Hero Image)
    // ==========================================
    async updateGameMetadata(gameId, metadata) {
        const index = this.dbCache.findIndex(g => String(g.id) === String(gameId));
        if (index > -1) {
            const game = this.dbCache[index];

            // تحديث الصور الحالية
            if (metadata.hero) game.heroImage = metadata.hero;
            if (metadata.cover) game.image = metadata.cover;
            if (metadata.logo) game.logo = metadata.logo;
            
            // 🔥 تحديث الـ Default لو كان فاضي أو لو دي أول مرة نحمل فيها ملفات لوكال
            // ده بيضمن ان الـ Reset يرجع للملفات اللي اتحملت في الكاش
            if (metadata.cover) game.defaultImage = metadata.cover;
            if (metadata.hero) game.defaultHero = metadata.hero;
            if (metadata.logo) game.defaultLogo = metadata.logo;
            
            this.saveDatabase(); 
            console.log(`💾 [DB] Metadata (and Defaults) saved for: ${game.name}`);
            return { status: 'success' };
        }
        return { status: 'error', message: 'Game not found' };
    }

    // ==========================================
    // 🗑️ CLEANUP IMAGES (Helper Function)
    // ==========================================
    deleteGameImages(gameId) {
        try {
            const cacheDir = path.join(this.dbFolder, 'image_cache');
            const types = ['cover', 'hero', 'logo'];
            
            // امسح الـ 3 أنواع صور المحتملة للـ ID ده
            types.forEach(type => {
                // بنحاول نخمن الامتداد (jpg أو png) أو نمسح الملفات اللي بتبدأ بالاسم ده
                const files = fsSync.readdirSync(cacheDir); // هات كل الملفات
                const targetFiles = files.filter(f => f.startsWith(`${type}_${gameId}`)); // فلتر صور اللعبة دي بس

                targetFiles.forEach(file => {
                    const filePath = path.join(cacheDir, file);
                    try {
                        fsSync.unlinkSync(filePath); // حذف الملف
                        console.log(`🗑️ Deleted image: ${file}`);
                    } catch (err) {
                        console.error(`Failed to delete ${file}:`, err);
                    }
                });
            });
        } catch (e) {
            console.error("Error cleaning up images:", e);
        }
    }

    // ==========================================
    // 🔃 REORDER SYSTEM
    // ==========================================
    async reorderLibrary(newOrderedIds) {
        try {
            // 1. عمل خريطة (Map) لتسهيل الوصول للألعاب القديمة
            const gameMap = new Map(this.dbCache.map(g => [g.id, g]));
            const newCache = [];

            // 2. إعادة بناء القائمة بناءً على الترتيب الجديد
            newOrderedIds.forEach(id => {
                if (gameMap.has(id)) {
                    newCache.push(gameMap.get(id));
                    gameMap.delete(id); // نحذفها عشان نعرف الباقي
                }
            });

            // 3. إضافة أي ألعاب متبقية (اللي ممكن تكون انضافت جديد ومظهرتش في الفرونت إند)
            for (const [id, game] of gameMap) {
                newCache.push(game);
            }

            // 4. الحفظ
            this.dbCache = newCache;
            this.saveDatabase();
            
            return { status: 'success' };
        } catch (e) {
            console.error("Reorder Error:", e);
            return { status: 'error' };
        }
    }
    

    
}




const engine = new BaddelEngine();

module.exports = { 
    scanAllGames: () => engine.startGlobalScan(),
    addManualGame: (exePath, customName) => engine.addManualGame(exePath, customName),
    getSavedGames: () => engine.getStoredGames(),
    forceSave: () => engine.saveDatabase(),
    renameGame: (id, name) => engine.renameGame(id, name), 
    removeGame: (id) => engine.removeGame(id), 
    unhideAllGames: () => engine.unhideAllGames(), 
    getHiddenGames: () => engine.getHiddenGames(),
    restoreSpecificGames: (ids) => engine.restoreSpecificGames(ids),
    deleteGamePermanently: (id) => engine.deleteGamePermanently(id),
    updateGameImage: (id, path, type) => engine.updateGameImage(id, path, type),
    resetGameImage: (id,type) => engine.resetGameImage(id, type),
    updateGameMetadata: (id, meta) => engine.updateGameMetadata(id, meta),
    reorderLibrary: (ids) => engine.reorderLibrary(ids),
};