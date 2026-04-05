const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const crypto = require('crypto');
const https = require('https');
const { app } = require('electron');
const { searchGame } = require('./services/steamgriddb');

// ============================================================
// ENGINE CLASS
// ============================================================
class BaddelEngine {
    constructor() {
        this.programData = process.env.ProgramData || 'C:\\ProgramData';
        this.appData = process.env.APPDATA || path.join(process.env.HOME, 'AppData', 'Roaming');
        this.dbFolder = app.getPath('userData');
        this.dbPath = path.join(this.dbFolder, 'games-db.json');
        this.officialPaths = new Set();
        this.dbCache = [];
        this._saveTimer = null;
        this.initDatabase();
    }

    // ============================================================
    // DATABASE
    // ============================================================
    generateStableId(game) {
        const str = (game.command || game.name).toLowerCase().replace(/"/g, '').trim();
        return crypto.createHash('md5').update(str).digest('hex').substring(0, 16);
    }

    initDatabase() {
        try {
            if (!fsSync.existsSync(this.dbFolder)) fsSync.mkdirSync(this.dbFolder, { recursive: true });
            if (!fsSync.existsSync(this.dbPath)) fsSync.writeFileSync(this.dbPath, '[]', 'utf8');
            const raw = fsSync.readFileSync(this.dbPath, 'utf8');
            try {
                this.dbCache = JSON.parse(raw);
            } catch {
                console.error('[DB] Corrupted — resetting.');
                this.dbCache = [];
                this.saveDatabase();
            }
        } catch (err) {
            console.error('[DB] Init error:', err);
            this.dbCache = [];
        }
    }

    // Async write with 500ms debounce to avoid blocking the main thread
    saveDatabase() {
        if (this._saveTimer) clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(async () => {
            try {
                const data = JSON.stringify(this.dbCache, null, 2);
                await fs.writeFile(this.dbPath, data, 'utf8');
            } catch (err) {
                console.error('[DB] Save failed:', err);
                try {
                    const backup = path.join(path.dirname(this.dbPath), 'games-db-backup.json');
                    await fs.writeFile(backup, JSON.stringify(this.dbCache, null, 2), 'utf8');
                } catch (backupErr) {
                    console.error('[DB] Backup also failed:', backupErr);
                }
            }
        }, 500);
    }

    // ============================================================
    // UPSERT
    // ============================================================
    async upsertGame(game) {
        if (!game.id) game.id = this.generateStableId(game);

        const index = this.dbCache.findIndex(g =>
            g.id === game.id ||
            (g.command && game.command &&
                g.command.replace(/"/g, '').toLowerCase().trim() ===
                game.command.replace(/"/g, '').toLowerCase().trim()) ||
            (g.platform && game.platform && g.name === game.name && g.platform === game.platform && g.platform !== 'Manual')
        );

        if (index > -1) {
            const existing = this.dbCache[index];
            const defImg  = existing.defaultImage || existing.image   || game.image;
            const defHero = existing.defaultHero  || existing.heroImage || game.heroImage;
            const defLogo = existing.defaultLogo  || existing.logo    || game.logo;

            this.dbCache[index] = {
                ...existing,
                command:      game.command      || existing.command,
                path:         game.path         || existing.path,
                platform:     game.platform     || existing.platform,
                image:        game.image        || existing.image,
                heroImage:    game.heroImage    || existing.heroImage,
                logo:         game.logo         || existing.logo,
                defaultImage: defImg,
                defaultHero:  defHero,
                defaultLogo:  defLogo,
                id:           existing.id
            };
        } else {
            // ── Recover cached images from disk if the DB was wiped (e.g. after reinstall) ──
            const cachedCover = game.image     || this.findInCache(game.id, 'cover');
            const cachedHero  = game.heroImage || this.findInCache(game.id, 'hero');
            const cachedLogo  = game.logo      || this.findInCache(game.id, 'logo');

            this.dbCache.push({
                addedAt: new Date().toISOString(),
                score: 100,
                isHidden: false,
                heroImage: null,
                logo: null,
                ...game,
                image:        cachedCover || game.image     || null,
                heroImage:    cachedHero  || game.heroImage || null,
                logo:         cachedLogo  || game.logo      || null,
                defaultImage: cachedCover || game.image     || null,
                defaultHero:  cachedHero  || game.heroImage || null,
                defaultLogo:  cachedLogo  || game.logo      || null
            });
        }
    }

    // ============================================================
    // CRUD OPERATIONS
    // ============================================================
    async renameGame(gameId, newName) {
        const index = this.dbCache.findIndex(g => g.id === gameId);
        if (index === -1) return { status: 'error', message: 'Game not found' };
        this.dbCache[index].name = newName;
        this.saveDatabase();
        return { status: 'success', newName };
    }

    async removeGame(gameId) {
        const index = this.dbCache.findIndex(g => String(g.id) === String(gameId));
        if (index === -1) return { status: 'error', message: 'Game not found' };
        this.dbCache[index].isHidden = true;
        this.saveDatabase();
        return { status: 'success' };
    }

    async unhideAllGames() {
        let count = 0;
        this.dbCache.forEach(g => { if (g.isHidden) { g.isHidden = false; count++; } });
        if (count > 0) { this.saveDatabase(); return { status: 'success', restoredCount: count }; }
        return { status: 'no_hidden' };
    }

    getStoredGames() { return this.dbCache.filter(g => !g.isHidden); }
    getHiddenGames() { return this.dbCache.filter(g => g.isHidden); }

    async restoreSpecificGames(gameIds) {
        let count = 0;
        this.dbCache.forEach(g => {
            if (gameIds.includes(String(g.id))) { g.isHidden = false; count++; }
        });
        if (count > 0) { this.saveDatabase(); return { status: 'success', count }; }
        return { status: 'error', message: 'Nothing restored' };
    }

    async deleteGamePermanently(gameId) {
        const before = this.dbCache.length;
        this.dbCache = this.dbCache.filter(g => String(g.id) !== String(gameId));
        if (this.dbCache.length < before) {
            this.deleteGameImages(gameId);
            this.saveDatabase();
            return { status: 'success' };
        }
        return { status: 'error', message: 'Game not found' };
    }

    // ============================================================
    // IMAGES
    // ============================================================
    async updateGameImage(gameId, newImagePath, type = 'cover') {
        const index = this.dbCache.findIndex(g => String(g.id) === String(gameId));
        if (index === -1) return { status: 'error', message: 'Game not found' };

        let finalPath = newImagePath;
        if (finalPath && !finalPath.startsWith('http') && !finalPath.startsWith('file://')) {
            finalPath = `file://${finalPath}`;
        }

        if (type === 'hero')       this.dbCache[index].heroImage = finalPath;
        else if (type === 'logo')  this.dbCache[index].logo = finalPath;
        else                       this.dbCache[index].image = finalPath;

        this.saveDatabase();
        return { status: 'success', path: finalPath, type };
    }

    async resetGameImage(gameId, type = 'cover') {
        const index = this.dbCache.findIndex(g => String(g.id) === String(gameId));
        if (index === -1) return { status: 'error', message: 'Game not found' };

        const game = this.dbCache[index];
        let restoredPath;
        if (type === 'hero') {
            restoredPath = game.defaultHero || this.findInCache(gameId, 'hero');
            game.heroImage = restoredPath;
        } else if (type === 'logo') {
            restoredPath = game.defaultLogo || this.findInCache(gameId, 'logo');
            game.logo = restoredPath;
        } else {
            restoredPath = game.defaultImage || this.findInCache(gameId, 'cover');
            game.image = restoredPath;
        }
        this.saveDatabase();
        return { status: 'success', type, path: restoredPath };
    }

    findInCache(gameId, type) {
        try {
            const cacheDir = path.join(this.dbFolder, 'image_cache');
            if (!fsSync.existsSync(cacheDir)) return null;
            const files = fsSync.readdirSync(cacheDir);
            const found = files.find(f => f.startsWith(`${type}_${gameId}`));
            return found ? `file://${path.join(cacheDir, found).replace(/\\/g, '/')}` : null;
        } catch { return null; }
    }

    deleteGameImages(gameId) {
        try {
            const cacheDir = path.join(this.dbFolder, 'image_cache');
            const files = fsSync.readdirSync(cacheDir);
            ['cover', 'hero', 'logo'].forEach(type => {
                files.filter(f => f.startsWith(`${type}_${gameId}`)).forEach(file => {
                    try { fsSync.unlinkSync(path.join(cacheDir, file)); } catch { /* ignore */ }
                });
            });
        } catch { /* ignore */ }
    }

async downloadToCache(url, gameId, type) {
        if (!url || !url.startsWith('http')) return null;
        const cacheDir = path.join(this.dbFolder, 'image_cache');
        if (!fsSync.existsSync(cacheDir)) fsSync.mkdirSync(cacheDir, { recursive: true });

        const ext = path.extname(url.split('?')[0]) || '.jpg';
        const filePath = path.join(cacheDir, `${type}_${gameId}${ext}`);
        const tmpPath = filePath + '.tmp'; // مسار الملف المؤقت

        return new Promise(resolve => {
            const file = fsSync.createWriteStream(tmpPath); // الكتابة في المؤقت
            const req = https.get(url, res => {
                if (res.statusCode !== 200) {
                    file.close();
                    fsSync.unlink(tmpPath, () => {});
                    resolve(null);
                    return;
                }
                res.pipe(file);
                file.on('finish', () => {
                    file.close(() => {
                        // إعادة التسمية بعد الانتهاء التام من الكتابة والإغلاق
                        try { fsSync.renameSync(tmpPath, filePath); } catch(e) {}
                        resolve(`file://${filePath.replace(/\\/g, '/')}`);
                    });
                });
            });

            req.setTimeout(7000, () => {
                req.destroy();
                file.close();
                fsSync.unlink(tmpPath, () => {});
                resolve(null);
            });

            req.on('error', () => {
                file.close();
                fsSync.unlink(tmpPath, () => {});
                resolve(null);
            });
        });
    }

    // ============================================================
    // METADATA
    // ============================================================
    async updateGameMetadata(gameId, metadata) {
        const index = this.dbCache.findIndex(g => String(g.id) === String(gameId));
        if (index === -1) return { status: 'error', message: 'Game not found' };
        const game = this.dbCache[index];
        if (metadata.hero)  { game.heroImage = metadata.hero;  game.defaultHero  = metadata.hero; }
        if (metadata.cover) { game.image     = metadata.cover; game.defaultImage = metadata.cover; }
        if (metadata.logo)  { game.logo      = metadata.logo;  game.defaultLogo  = metadata.logo; }
        this.saveDatabase();
        return { status: 'success' };
    }

    // ============================================================
    // PLAYTIME
    // ============================================================
    async updatePlaytime(gameId, playedMinutes) {
        const index = this.dbCache.findIndex(g => String(g.id) === String(gameId));
        if (index === -1) return { status: 'error', message: 'Game not found' };

        const game = this.dbCache[index];
        game.totalPlaytime = (game.totalPlaytime || 0) + playedMinutes;
        game.lastPlayed = Date.now();

        if (!game.playSessions) game.playSessions = [];
        const today = new Date().toISOString().split('T')[0];
        const session = game.playSessions.find(s => s.date === today);
        if (session) session.minutes += playedMinutes;
        else game.playSessions.push({ date: today, minutes: playedMinutes });

        this.saveDatabase();
        return {
            status: 'success',
            totalPlaytime: game.totalPlaytime,
            lastPlayed: game.lastPlayed,
            playSessions: game.playSessions
        };
    }

    // ============================================================
    // REORDER
    // ============================================================
    async reorderLibrary(newOrderedIds) {
        try {
            const gameMap = new Map(this.dbCache.map(g => [g.id, g]));
            const ordered = newOrderedIds.filter(id => gameMap.has(id)).map(id => {
                const g = gameMap.get(id);
                gameMap.delete(id);
                return g;
            });
            this.dbCache = [...ordered, ...gameMap.values()];
            this.saveDatabase();
            return { status: 'success' };
        } catch (err) {
            console.error('[Reorder]', err);
            return { status: 'error' };
        }
    }

    // ============================================================
    // MANUAL ADD
    // ============================================================
async addManualGame(exePath, customName = null, notifyCallback = null) {
        try {
            const stats = await fs.stat(exePath);
            if (!stats.isFile()) return { status: 'error', message: 'File not found' };

            const exeName      = path.parse(exePath).name.replace(/[-_]/g, ' ').trim();
            const parentFolder = path.basename(path.dirname(exePath)).replace(/[-_]/g, ' ').trim();
            const searchSteps  = [
                { name: exeName,      source: 'EXE Name' },
                { name: customName,   source: 'User Input' },
                { name: parentFolder, source: 'Folder Name' }
            ].filter(s => s.name?.trim());

            let finalMetadata = null;
            let finalName = customName || exeName;

            for (const step of searchSteps) {
                try {
                    const meta = await searchGame(step.name);
                    if (meta?.cover) { finalMetadata = meta; if (!customName) finalName = step.name; break; }
                } catch { /* try next */ }
            }

            const normalizedPath = path.normalize(exePath).toLowerCase().trim();
            const existingIndex = this.dbCache.findIndex(g =>
                path.normalize((g.command || '').replace(/"/g, '').trim()).toLowerCase() === normalizedPath
            );
            if (existingIndex > -1) {
                const existing = this.dbCache[existingIndex];
                if (existing.isHidden) { existing.isHidden = false; this.saveDatabase(); }
                return { status: 'success', game: existing };
            }

            const tempId = this.generateStableId({ command: `"${exePath}"`, name: customName || exeName });
            const newGame = {
                id: tempId,
                name: finalName,
                command: `"${exePath}"`,
                platform: 'Manual',
                image:     finalMetadata?.cover || null,
                heroImage: finalMetadata?.hero  || null,
                logo:      finalMetadata?.logo  || null,
                score: 100,
                isHidden: false,
                addedAt: new Date().toISOString()
            };

            await this.upsertGame(newGame);
            this.saveDatabase();

            if (finalMetadata) this.backgroundDownload(finalMetadata, tempId, notifyCallback);
            return { status: 'success', game: newGame };
        } catch (err) {
            console.error('[Manual Add]', err);
            return { status: 'error', message: err.message };
        }
    }

async backgroundDownload(metadata, gameId, notifyCallback = null) {
        try {
            const [cover, hero, logo] = await Promise.all([
                metadata.cover ? this.downloadToCache(metadata.cover, gameId, 'cover') : null,
                metadata.hero  ? this.downloadToCache(metadata.hero,  gameId, 'hero')  : null,
                metadata.logo  ? this.downloadToCache(metadata.logo,  gameId, 'logo')  : null
            ]);
            if (cover || hero || logo) {
                await this.updateGameMetadata(gameId, {
                    cover: cover || metadata.cover,
                    hero:  hero  || metadata.hero,
                    logo:  logo  || metadata.logo
                });
                
                // 🔴 إرسال إشعار للواجهة بعد اكتمال التحميل تماماً
                if (notifyCallback) {
                    const updatedGame = this.dbCache.find(g => g.id === gameId);
                    if (updatedGame) notifyCallback(updatedGame);
                }
            }
        } catch (err) {
            console.error('[Background Download]', err);
        }
}

    // ============================================================
    // PLATFORM SCANNERS
    // ============================================================
    async getOfficialGames() {
        const results = await Promise.allSettled([
            this.getSteamGames(),
            this.getEpicGames(),
            this.getRiotGames(),
            this.getUbisoftGames(),
            this.getEAGames(),
            this.getXboxGames()
        ]);
        const flatList = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
        flatList.forEach(g => { if (g.path) this.officialPaths.add(g.path.toLowerCase()); });
        return flatList;
    }

    // --- Steam ---
    async getSteamGames() {
        const games = [];
        try {
            const { stdout } = await execAsync(`powershell -command "Get-ItemProperty 'HKCU:\\Software\\Valve\\Steam' | Select-Object -ExpandProperty SteamPath"`);
            const steamPath = stdout.trim();
            if (!steamPath) return [];

            const vdfPath = path.join(steamPath, 'steamapps', 'libraryfolders.vdf');
            const content = await fs.readFile(vdfPath, 'utf8');
            const matches = content.match(/"path"\s+"([^"]+)"/g);
            const libraries = [...new Set(
                matches ? matches.map(m => m.match(/"path"\s+"([^"]+)"/)[1].replace(/\\\\/g, '\\')) : [steamPath]
            )];

            for (const lib of libraries) {
                const appsPath = path.join(lib, 'steamapps');
                try {
                    const files = await fs.readdir(appsPath);
                    for (const file of files) {
                        if (!file.startsWith('appmanifest_') || !file.endsWith('.acf')) continue;
                        const acf = await fs.readFile(path.join(appsPath, file), 'utf8');
                        const name  = acf.match(/"name"\s+"([^"]+)"/i)?.[1];
                        const id    = acf.match(/"appid"\s+"(\d+)"/i)?.[1];
                        const dir   = acf.match(/"installdir"\s+"([^"]+)"/i)?.[1];
                        const flags = acf.match(/"StateFlags"\s+"(\d+)"/i)?.[1];
                        if (name && id && !name.includes('Steamworks')) {
                            games.push({
                                id: `steam-${id}`,
                                name, platform: 'Steam',
                                path: path.join(appsPath, 'common', dir || ''),
                                command: `steam://run/${id}`,
                                score: 100,
                                needsUpdate: flags !== '4'
                            });
                        }
                    }
                } catch { /* library may be unavailable */ }
            }
        } catch (err) { console.error('[Steam Scan]', err); }
        return games;
    }

    // --- Local Steam Games (For Sync) ---
    async getLocalSteamGames() {
        const games = [];
        try {
            const { stdout } = await execAsync(`powershell -command "Get-ItemProperty 'HKCU:\\Software\\Valve\\Steam' | Select-Object -ExpandProperty SteamPath"`);
            const steamPath = stdout.trim();
            if (!steamPath) return [];

            const vdfPath = path.join(steamPath, 'steamapps', 'libraryfolders.vdf');
            const fs = require('fs').promises;
            const content = await fs.readFile(vdfPath, 'utf8');
            const matches = content.match(/"path"\s+"([^"]+)"/g);
            const libraries = [...new Set(
                matches ? matches.map(m => m.match(/"path"\s+"([^"]+)"/)[1].replace(/\\\\/g, '\\')) : [steamPath]
            )];

            for (const lib of libraries) {
                const appsPath = path.join(lib, 'steamapps');
                try {
                    const files = await fs.readdir(appsPath);
                    for (const file of files) {
                        if (!file.startsWith('appmanifest_') || !file.endsWith('.acf')) continue;
                        const acf = await fs.readFile(path.join(appsPath, file), 'utf8');
                        const name  = acf.match(/"name"\s+"([^"]+)"/i)?.[1];
                        const appid = acf.match(/"appid"\s+"(\d+)"/i)?.[1];
                        if (name && appid && !name.includes('Steamworks')) {
                            // بنرجع appid و name عشان platformSync.js بيعتمد عليهم
                            games.push({ appid, name });
                        }
                    }
                } catch { /* ignore */ }
            }
        } catch (err) { console.error('[Local Steam Scan]', err); }
        return games;
    }

    // --- Epic Games ---
    async getEpicGames() {
        const games = [];
        const root = path.join(this.programData, 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests');
        if (!fsSync.existsSync(root)) return games;
        try {
            const files = await fs.readdir(root);
            for (const file of files.filter(f => f.endsWith('.item'))) {
                const data = JSON.parse(await fs.readFile(path.join(root, file), 'utf8'));
                const { DisplayName, InstallLocation, CatalogNamespace, CatalogItemId, AppName } = data;
                if (!InstallLocation || !fsSync.existsSync(InstallLocation)) continue;
                if (DisplayName && CatalogNamespace && CatalogItemId) {
                    games.push({
                        id: `epic-${AppName}`,
                        name: DisplayName,
                        platform: 'Epic Games',
                        path: InstallLocation,
                        command: `com.epicgames.launcher://apps/${CatalogNamespace}%3A${CatalogItemId}%3A${AppName}?action=launch&silent=true`,
                        score: 100
                    });
                }
            }
        } catch (err) { console.error('[Epic Scan]', err); }
        return games;
    }

    // --- Riot Games ---
    // Win10 note: RiotClientServices.exe may not expose --launch-product in ps-list
    // cmd output due to the way Win10 creates child processes. We therefore also
    // include the real game EXE path so the playtime tracker can match directly.
    async getRiotGames() {
        const games = [];
        let basePath = null, clientExe = null;

        // 1. Primary source: RiotClientInstalls.json
        try {
            const data = JSON.parse(await fs.readFile(
                path.join(this.programData, 'Riot Games', 'RiotClientInstalls.json'), 'utf8'
            ));
            if (data.rc_default) {
                clientExe = data.rc_default.replace(/\\\\/g, '\\');
            }
            for (const key of Object.keys(data.associated_client || {})) {
                const val = data.associated_client[key].replace(/\\\\/g, '\\');
                if (key.includes('valorant') && !basePath) {
                    basePath = path.dirname(path.dirname(val));
                } else if (key.includes('league') && !basePath) {
                    basePath = path.dirname(path.dirname(val));
                }
            }
            if (clientExe && !basePath) basePath = path.dirname(path.dirname(clientExe));
        } catch { /* no Riot install */ }

        // 2. Resolve actual game EXE paths for reliable Win10 process detection
        const RIOT_GAMES = [
            {
                dirName:   'VALORANT',
                name:      'VALORANT',
                product:   'valorant',
                gameExe:   path.join('live', 'GAME', 'VALORANT', 'Binaries', 'Win64', 'VALORANT-Win64-Shipping.exe')
            },
            {
                dirName:   'League of Legends',
                name:      'League of Legends',
                product:   'league_of_legends',
                gameExe:   path.join('Game', 'League of Legends.exe')
            }
        ];

        const tryReadBase = async (base, exePath) => {
            try {
                const dirs = await fs.readdir(base, { withFileTypes: true });
                for (const dir of dirs) {
                    if (!dir.isDirectory()) continue;
                    const lower = dir.name.toLowerCase();
                    const def = RIOT_GAMES.find(g => g.dirName.toLowerCase() === lower);
                    if (!def) continue;

                    const gameDirPath = path.join(base, dir.name);
                    const realExePath = path.join(gameDirPath, def.gameExe);
                    const command = exePath
                        ? `"${exePath}" --launch-product=${def.product} --launch-patchline=live`
                        : `explorer.exe "${gameDirPath}"`;

                    // path points to the actual game EXE so the tracker can match
                    // it even when the RiotClient command-line args are hidden on Win10
                    games.push({
                        name:     def.name,
                        platform: 'Riot Games',
                        path:     gameDirPath,
                        command,
                        score:    100
                    });
                }
            } catch { /* ignore */ }
        };

        if (basePath) await tryReadBase(basePath, clientExe);

        // 3. Fallback: scan every drive for "Riot Games" folder
        if (games.length === 0) {
            let drives = ['C:\\'];
            try {
                const { stdout } = await execAsync(
                    'powershell -NoProfile -Command "Get-PSDrive -PSProvider FileSystem | Select-Object -ExpandProperty Name"',
                    { timeout: 5000 }
                );
                drives = stdout.split(/\r?\n/).filter(d => d.trim()).map(d => `${d.trim()}:\\`);
            } catch { /* fallback to C */ }

            for (const drive of drives) {
                const riotBase = path.join(drive, 'Riot Games');
                const fallbackExe = path.join(riotBase, 'Riot Client', 'RiotClientServices.exe');
                let hasClient = false;
                try { await fs.access(fallbackExe); hasClient = true; } catch { /* no client */ }
                await tryReadBase(riotBase, hasClient ? fallbackExe : null);
                if (games.length > 0) break;
            }
        }
        return games;
    }

    // --- Ubisoft Connect ---
    async getUbisoftGames() {
        const games = [];
        // سكريبت احترافي بيقرأ المسار من ملفات يوبي سوفت الأصلية لو ملقاهوش في الويندوز
        const psScript = `$installs = @(); $u = 'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Uplay Install *'; $ubi = 'HKLM:\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher\\Installs'; Get-ItemProperty $u -ErrorAction SilentlyContinue | ForEach-Object { $id = $_.PSChildName.Replace('Uplay Install ', '').Trim(); $dir = $_.InstallLocation; if (-not $dir) { $dir = (Get-ItemProperty \\"$ubi\\$id\\" -Name InstallDir -ErrorAction SilentlyContinue).InstallDir }; if ($dir) { $installs += [PSCustomObject]@{ Id = $id; Name = $_.DisplayName; Path = $dir } } }; $installs | ConvertTo-Json`;
        
        try {
            const { stdout } = await execAsync(`powershell -command "${psScript}"`);
            if (!stdout?.trim()) return games;
            let installs = JSON.parse(stdout);
            if (!Array.isArray(installs)) installs = [installs];
            
            installs.forEach(g => {
                if (!g.Path || !g.Name) return;
                games.push({
                    name: g.Name,
                    platform: 'Ubisoft Connect',
                    path: g.Path.replace(/"/g, '').replace(/\\\\/g, '\\'),
                    command: `uplay://launch/${g.Id}/0`,
                    score: 100
                });
            });
        } catch (err) { console.error('[Ubisoft Scan]', err); }
        return games;
    }

    // --- EA App ---
    // --- EA App ---
    async getEAGames() {
        const games = [];
        const manifestsDir = path.join(process.env.ProgramData, 'EA Desktop', 'InstallData');
        if (!fsSync.existsSync(manifestsDir)) return games;

        // 1. جلب مسارات ألعاب EA الفعلية من الريجستري
        let eaPathsMap = new Map();
        try {
            const ps = `Get-ItemProperty 'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object { $_.Publisher -match 'Electronic Arts' -and $_.InstallLocation } | Select-Object DisplayName, InstallLocation | ConvertTo-Json`;
            const { stdout } = await execAsync(`powershell -command "${ps}"`);
            if (stdout?.trim()) {
                let regApps = JSON.parse(stdout);
                if (!Array.isArray(regApps)) regApps = [regApps];
                regApps.forEach(app => {
                    if (app.DisplayName && app.InstallLocation) {
                        eaPathsMap.set(app.DisplayName.toLowerCase().replace(/[^a-z0-9]/g, ''), app.InstallLocation);
                    }
                });
            }
        } catch (e) { console.error('[EA Reg Scan]', e); }

        try {
            const folders = await fs.readdir(manifestsDir, { withFileTypes: true });
            for (const folder of folders.filter(f => f.isDirectory())) {
                const folderPath = path.join(manifestsDir, folder.name);
                const subFiles = await fs.readdir(folderPath);
                const baseFolder = subFiles.find(f => f.startsWith('base-'));
                let realOfferId = baseFolder?.replace('base-', '') || null;
                let gameName = folder.name;

                const jsonFile = subFiles.find(f => f.endsWith('.json'));
                if (jsonFile) {
                    const data = JSON.parse(await fs.readFile(path.join(folderPath, jsonFile), 'utf8'));
                    gameName = data.title || data.Title || gameName;
                    if (!realOfferId) realOfferId = data.offerId || data.contentIds?.[0];
                }

                if (realOfferId) {
                    // 2. ربط المسار الحقيقي باللعبة!
                    const cleanName = gameName.toLowerCase().replace(/[^a-z0-9]/g, '');
                    const gamePath = eaPathsMap.get(cleanName) || '';

                    games.push({
                        id: `ea-${realOfferId}`,
                        name: gameName,
                        platform: 'EA App',
                        path: gamePath, // 🔴 وداعاً للمسار الفاضي!
                        command: `origin2://game/launch?offerIds=${realOfferId}`,
                        score: 95
                    });
                }
            }
        } catch (err) { console.error('[EA Scan]', err); }
        return games;
    }

    // --- Xbox / Store (runs entirely in background, never blocks library load) ---
    async getXboxGames() {
        const BLOAT = new Set([
            'soundcloud','scratch','devhome','clipchamp','auracreator','armourycrate',
            'xlsxeditor','heicconverter','communicationsapps','sibist','smallapp',
            'ink','handwriting','oneconnect','connect','streaming','xboxapp','xboxgaming',
            'identity','insider','operatingenvironment','xboxone','overlay','service',
            'provider','runtime','component','plugin','extension','agent','library',
            'middleware','bios','driver','shell','experience','host','auth','secure',
            'native','telemetry','console','dialog','compatibility','enhancement','source',
            'broker','ui','xaml','health','bgtask','background','task','manager',
            'setting','config','cortana','copilot','edge','onedrive','teams','skype',
            'office','outlook','onenote','powerautomate','todo','whiteboard','tips',
            'feedback','help','calculator','alarms','maps','camera','photos',
            'soundrecorder','paint','terminal','notepad','stickynotes','phone','people',
            'wallet','news','weather','store','installer','purchase','family',
            'crossdevice','winget','bing','zune','sketch','screen','media','control',
            'gamingapp','instagram','facebook','messenger','whatsapp','telegram',
            'twitter','xcorp','tiktok','snapchat','reddit','pinterest','linkedin',
            'discord','slack','zoom','netflix','spotify','disney','hulu','prime',
            'amazonvideo','itunes','applemusic','vlc','crunchyroll','twitch','youtube',
            'pandora','deezer','tidal','adobe','photoshop','lightroom','canva','picsart',
            'dolby','realtek','nvidia','intel','amd','hp','dell','lenovo','asus','acer',
            'msi','razer','translucent','wallpaper','studio','obs','audacity','winrar','zip'
        ]);
        const EXCEPTIONS = ['minesweeper', 'minecraft', 'roblox', 'solitaire'];
        const games = [];

        const ps = `Get-AppxPackage | Where-Object { $_.IsFramework -eq $false -and $_.SignatureKind -eq 'Store' -and $_.InstallLocation } | Select-Object Name, PackageFamilyName, InstallLocation | ConvertTo-Json`;
        try {
            const { stdout } = await execAsync(`powershell -command "${ps}"`, { maxBuffer: 50 * 1024 * 1024 });
            if (!stdout?.trim()) return [];
            let apps = JSON.parse(stdout);
            if (!Array.isArray(apps)) apps = [apps];

            const candidates = apps
                .filter(app => {
                    const lower = app.Name.toLowerCase();
                    const isException = EXCEPTIONS.some(e => lower.includes(e));
                    if (isException) return true;
                    return ![...BLOAT].some(b => lower.includes(b)) &&
                        !lower.includes('client') && !lower.includes('overlay') && !lower.includes('service');
                })
                .map(app => ({
                    name: app.Name.replace(/Microsoft\./i, '').replace(/\./g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim(),
                    platform: 'Xbox / Store',
                    path: app.InstallLocation,
                    command: `explorer.exe shell:AppsFolder\\${app.PackageFamilyName}!App`,
                    score: 90
                }));

            // Rate-limited metadata lookup: batch with concurrency limit instead of sequential delay
            const CONCURRENCY = 3;
            let index = 0;

            const worker = async () => {
                while (index < candidates.length) {
                    const candidate = candidates[index++];
                    const isException = EXCEPTIONS.some(e => candidate.name.toLowerCase().includes(e));
                    if (isException) { games.push(candidate); continue; }
                    try {
                        const meta = await searchGame(candidate.name);
                        if (meta?.cover) {
                            candidate.image = meta.cover;
                            candidate.heroImage = meta.hero;
                            games.push(candidate);
                        }
                    } catch { /* skip if network fails */ }
                }
            };

            await Promise.all(Array.from({ length: CONCURRENCY }, worker));
        } catch (err) { console.error('[Xbox Scan]', err); }
        return games;
    }

    // ============================================================
    // GLOBAL SCAN
    // ============================================================
    async startGlobalScan() {
        const official = await this.getOfficialGames();

        const uniqueMap = new Map();
        for (const game of official) {
            const key = game.name.toLowerCase().trim();
            if (!uniqueMap.has(key)) uniqueMap.set(key, game);
        }

        for (const game of uniqueMap.values()) {
            try {
                await this.upsertGame(game);
            } catch {
                console.log(`[Scan] Skipping ${game.name}`);
            }
        }

        this.saveDatabase();
        return this.getStoredGames()
    }
}

// ============================================================
// SINGLETON + EXPORTS
// ============================================================
const engine = new BaddelEngine();
async function refetchMissingImages(notifyCallback) {
    const fsSync = require('fs');
    let updated = false;

    for (let game of engine.dbCache) {
        if (!game.isHidden) {
            let isMissing = false;

            if (game.image && game.image.startsWith('file://')) {
                try {
                    const cleanPath = decodeURI(game.image.replace('file://', ''));
                    if (!fsSync.existsSync(cleanPath)) isMissing = true;
                } catch (e) { isMissing = true; }
            } else if (!game.image) {
                isMissing = true;
            }

            if (isMissing) {
                try {
                    const meta = await searchGame(game.name);
                    if (meta && meta.cover) {
                        await engine.backgroundDownload(meta, game.id);
                        if (notifyCallback) notifyCallback(engine.dbCache.find(g => g.id === game.id));
                        updated = true;
                    }
                } catch (e) { /* skip */ }
            }
        }
    }
    if (updated) engine.saveDatabase();
}

module.exports = {
    scanAllGames:          () => engine.startGlobalScan(),
    addManualGame:         (exePath, customName, cb) => engine.addManualGame(exePath, customName, cb),
    getSavedGames:         () => engine.getStoredGames(),
    renameGame:            (id, name) => engine.renameGame(id, name),
    removeGame:            (id) => engine.removeGame(id),
    unhideAllGames:        () => engine.unhideAllGames(),
    getHiddenGames:        () => engine.getHiddenGames(),
    restoreSpecificGames:  (ids) => engine.restoreSpecificGames(ids),
    deleteGamePermanently: (id) => engine.deleteGamePermanently(id),
    updateGameImage:       (id, imgPath, type) => engine.updateGameImage(id, imgPath, type),
    resetGameImage:        (id, type) => engine.resetGameImage(id, type),
    updateGameMetadata:    (id, meta) => engine.updateGameMetadata(id, meta),
    reorderLibrary:        (ids) => engine.reorderLibrary(ids),
    updatePlaytime:        (id, minutes) => engine.updatePlaytime(id, minutes),
    refetchMissingImages:  (cb) => refetchMissingImages(cb),
    getLocalSteamGames:    () => engine.getLocalSteamGames()
};
