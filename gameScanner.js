const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const crypto = require('crypto');
let electronApp = null;
try { electronApp = require('electron').app; } catch { /* node test environment */ }
const app = (electronApp && typeof electronApp.getPath === 'function')
    ? electronApp
    : {
        getPath(name) {
            if (name === 'userData') {
                return process.env.BADDEL_TEST_USER_DATA ||
                    process.env.BADDEL_USER_DATA ||
                    path.join(os.tmpdir(), 'BaddelLauncher-userData');
            }
            if (name === 'desktop') return path.join(os.homedir(), 'Desktop');
            return os.tmpdir();
        }
    };
const baddelApi = require('./services/baddelApi');
const { MetadataResolutionManager, STATUS: MRM_STATUS } = require('./services/metadataResolutionManager');
const { generateMetadataCandidates } = require('./services/candidateGenerator');

// All image/game data is now handled by baddelApi server

// ─── Cache file stem helper ───────────────────────────────────────────────────
// Single source of truth for the file name prefix used by every asset writer
// and reader (findInCache, deleteGameImages, registerImageDownloader, IPC handlers).
// Format: "${type}_${gameId}"  e.g. "cover_abc123def456"
// Must stay in sync with imageWebpCache.cacheBaseName (same formula).
function _cacheBaseName(type, gameId) {
    return `${type}_${String(gameId)}`;
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

const SCANNER_PLATFORMS = new Set(['steam', 'epic', 'riot', 'ubisoft', 'ea', 'xbox']);

const PLATFORM_LABEL_TO_KEY = {
    steam: 'steam',
    'steam games': 'steam',
    epic: 'epic',
    'epic games': 'epic',
    riot: 'riot',
    'riot games': 'riot',
    ubisoft: 'ubisoft',
    'ubisoft connect': 'ubisoft',
    ea: 'ea',
    'ea app': 'ea',
    origin: 'ea',
    xbox: 'xbox',
    'xbox / store': 'xbox',
    'microsoft store': 'xbox',
    store: 'xbox',
};

function _cleanPathInput(p) {
    if (!p || typeof p !== 'string') return '';
    let s = p.trim().replace(/^"+|"+$/g, '');
    if (!s) return '';
    s = s.replace(/^file:\/+/i, '');
    try { return path.normalize(s); } catch { return s; }
}

function normalizePath(p) {
    const clean = _cleanPathInput(p);
    return clean ? clean.replace(/[\\\/]+$/g, '').toLowerCase() : '';
}

function pathExists(p) {
    const clean = _cleanPathInput(p);
    if (!clean) return false;
    try { return fsSync.existsSync(clean); } catch { return false; }
}

function fileExists(p) {
    const clean = _cleanPathInput(p);
    if (!clean) return false;
    try { return fsSync.statSync(clean).isFile(); } catch { return false; }
}

function dirExists(p) {
    const clean = _cleanPathInput(p);
    if (!clean) return false;
    try { return fsSync.statSync(clean).isDirectory(); } catch { return false; }
}

function isLauncherOrHelperExe(fileName) {
    const lower = path.basename(String(fileName || '')).toLowerCase();
    if (!lower.endsWith('.exe')) return true;

    const exact = new Set([
        'steam.exe', 'steamservice.exe', 'steamwebhelper.exe',
        'epicgameslauncher.exe', 'epicwebhelper.exe',
        'riotclientservices.exe', 'riotclientux.exe', 'riotclientuxrender.exe',
        'ubisoftconnect.exe', 'upc.exe', 'uplay.exe',
        'eadesktop.exe', 'ealauncher.exe', 'origin.exe',
        'gamelaunchhelper.exe', 'launchhelper.exe',
        'uninstall.exe', 'unins000.exe', 'unins001.exe',
        'setup.exe', 'installer.exe', 'dxsetup.exe', 'vcredist.exe',
        'easyanticheat_setup.exe', 'beservice.exe', 'battleye.exe',
        'crashreporter.exe', 'crashpad_handler.exe',
    ]);
    if (exact.has(lower)) return true;

    return [
        /^unins\d*\.exe$/,
        /uninstall/,
        /crash.?report/,
        /crashpad/,
        /setup/,
        /installer/,
        /installhelper/,
        /bootstrap/,
        /redistribut/i,
        /vcredist/,
        /directx/,
        /dxsetup/,
        /easyanticheat.*setup/,
        /battleye.*setup/,
        /support/,
        /repair/,
        /cleanup/,
        /updater?\.exe$/,
        /webhelper/,
        /cef/,
        /overlay/,
    ].some(re => re.test(lower));
}

function _isIgnoredUtilityFile(fileName) {
    const lower = path.basename(String(fileName || '')).toLowerCase();
    if (!lower) return true;
    if (lower.endsWith('.exe')) return isLauncherOrHelperExe(lower);
    return [
        '.url', '.lnk', '.log', '.txt', '.md', '.ini', '.cfg', '.json',
        '.xml', '.html', '.htm', '.tmp', '.old', '.bak'
    ].some(ext => lower.endsWith(ext));
}

function _isIgnoredScanDir(dirName) {
    const lower = String(dirName || '').toLowerCase();
    return [
        '_commonredist', 'commonredist', 'redist', 'redistributable',
        'directx', 'support', 'installer', 'installers', '__installer',
        'easyanticheat', 'battleye', 'crashreport', 'logs', 'log',
        'webcache', 'cache'
    ].includes(lower);
}

function dirHasUsefulFiles(root, options = {}) {
    const cleanRoot = _cleanPathInput(root);
    if (!dirExists(cleanRoot)) return false;
    const maxDepth = Number.isFinite(options.maxDepth) ? options.maxDepth : 2;
    const maxEntries = Number.isFinite(options.maxEntries) ? options.maxEntries : 500;
    let seen = 0;

    function walk(dir, depth) {
        if (seen > maxEntries) return false;
        let entries;
        try { entries = fsSync.readdirSync(dir, { withFileTypes: true }); } catch { return false; }
        for (const entry of entries) {
            seen++;
            if (entry.isDirectory()) {
                if (depth < maxDepth && !_isIgnoredScanDir(entry.name)) {
                    if (walk(path.join(dir, entry.name), depth + 1)) return true;
                }
                continue;
            }
            if (!entry.isFile()) continue;
            if (!_isIgnoredUtilityFile(entry.name)) return true;
        }
        return false;
    }

    return walk(cleanRoot, 0);
}

function findFirstExisting(paths) {
    for (const p of Array.isArray(paths) ? paths : []) {
        const clean = _cleanPathInput(p);
        if (clean && pathExists(clean)) return clean;
    }
    return null;
}

function _scoreExeCandidate(filePath, root, options = {}) {
    const base = path.basename(filePath).toLowerCase();
    if (!base.endsWith('.exe') || isLauncherOrHelperExe(base)) return -Infinity;

    const preferred = (options.preferredNames || []).map(n => String(n).toLowerCase());
    const includePatterns = options.includeNamePatterns || [];
    if (includePatterns.length && !includePatterns.some(re => re.test(base))) return -Infinity;

    let score = 10;
    if (preferred.includes(base)) score += 1000 - preferred.indexOf(base);

    const hint = normalizeDisplayName(options.nameHint || path.basename(root || '')).toLowerCase().replace(/[^a-z0-9]/g, '');
    const exeStem = base.replace(/\.exe$/i, '').replace(/[^a-z0-9]/g, '');
    if (hint && (exeStem.includes(hint) || hint.includes(exeStem))) score += 90;

    const lowerPath = filePath.toLowerCase();
    if (lowerPath.includes('\\binaries\\') || lowerPath.includes('/binaries/')) score += 25;
    if (lowerPath.includes('\\win64\\') || lowerPath.includes('/win64/')) score += 20;
    if (lowerPath.includes('\\bin\\') || lowerPath.includes('/bin/')) score += 10;
    if (base.includes('shipping')) score += 20;
    if (base.includes('server') || base.includes('dedicated') || base.includes('editor') || base.includes('benchmark')) score -= 60;
    if (base === 'game.exe' || base === 'launcher.exe') score -= 40;
    return score;
}

function findLikelyGameExe(root, options = {}) {
    const cleanRoot = _cleanPathInput(root);
    if (fileExists(cleanRoot) && cleanRoot.toLowerCase().endsWith('.exe')) {
        return isLauncherOrHelperExe(cleanRoot) ? null : cleanRoot;
    }
    if (!dirExists(cleanRoot)) return null;

    const preferredPaths = (options.preferredPaths || []).map(p => path.isAbsolute(p) ? p : path.join(cleanRoot, p));
    const preferredExisting = findFirstExisting(preferredPaths);
    if (preferredExisting && fileExists(preferredExisting) && !isLauncherOrHelperExe(preferredExisting)) return preferredExisting;

    const maxDepth = Number.isFinite(options.maxDepth) ? options.maxDepth : 5;
    const maxEntries = Number.isFinite(options.maxEntries) ? options.maxEntries : 1500;
    const excludeDirs = new Set([...(options.excludeDirs || []), '_commonredist', 'redist', 'redistributable', 'directx', 'support', 'easyanticheat', 'battleye'].map(s => String(s).toLowerCase()));
    let visited = 0;
    let best = null;
    let bestScore = -Infinity;

    function walk(dir, depth) {
        if (visited > maxEntries || depth > maxDepth) return;
        let entries;
        try { entries = fsSync.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
            visited++;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (!excludeDirs.has(entry.name.toLowerCase()) && !_isIgnoredScanDir(entry.name)) {
                    walk(full, depth + 1);
                }
                continue;
            }
            if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.exe')) continue;
            const score = _scoreExeCandidate(full, cleanRoot, options);
            if (score > bestScore || (score === bestScore && best && full.length < best.length)) {
                best = full;
                bestScore = score;
            }
        }
    }

    walk(cleanRoot, 0);
    return bestScore > -Infinity ? best : null;
}

function safeJsonParse(raw, fallback = null) {
    try {
        if (raw == null || raw === '') return fallback;
        return JSON.parse(raw);
    } catch {
        return fallback;
    }
}

function normalizeDisplayName(name) {
    return String(name || '')
        .replace(/\s+/g, ' ')
        .replace(/\b(TM|R|C)\b/g, '')
        .replace(/[™®©]/g, '')
        .trim();
}

function normalizeScannerPlatform(platform) {
    const key = String(platform || '').toLowerCase().trim();
    return PLATFORM_LABEL_TO_KEY[key] || key;
}

function _hashShort(value) {
    return crypto.createHash('md5').update(String(value || '')).digest('hex').substring(0, 16);
}

function makeInstalledGameKey(game = {}) {
    const platform = normalizeScannerPlatform(game.scannerPlatform || game.platform || game.source);
    const ids = game.allIds || {};
    if (platform === 'steam') {
        const appid = ids.steam || game.launcherGameId || String(game.id || '').replace(/^steam[-_]/i, '');
        if (/^\d+$/.test(String(appid))) return `steam:${appid}`;
    }
    if (platform === 'epic') {
        const ns = game.catalogNamespace || game.namespace || ids.epic || '';
        const item = game.catalogItemId || game.catalogItemID || game.catalogId || '';
        const appName = game.appName || game.app_name || '';
        const launcherId = game.launcherGameId || [ns, item, appName].filter(Boolean).join(':');
        if (launcherId) return `epic:${String(launcherId).toLowerCase()}`;
    }
    if (platform === 'riot') {
        const product = game.riotProduct || game.launcherGameId || ids.riot;
        if (product) return `riot:${String(product).toLowerCase()}`;
    }
    if (platform === 'ubisoft') {
        const appId = game.ubisoftAppId || game.launcherGameId || ids.ubisoft;
        if (appId) return `ubisoft:${String(appId).toLowerCase()}`;
        const p = normalizePath(game.path || game.installPath || game.executablePath);
        if (p) return `ubisoft:path:${_hashShort(p)}`;
    }
    if (platform === 'ea') {
        const appId = game.eaAppId || game.launcherGameId || ids.ea;
        if (appId) return `ea:${String(appId).toLowerCase()}`;
        const p = normalizePath(game.path || game.installPath || game.executablePath);
        if (p) return `ea:path:${_hashShort(p)}`;
    }
    if (platform === 'xbox') {
        const pfn = game.packageFamilyName || game.launcherGameId || ids.xbox;
        if (pfn) return `xbox:${String(pfn).toLowerCase()}`;
    }

    const p = normalizePath(game.path || game.installPath || game.executablePath);
    if (platform && p) return `${platform}:path:${_hashShort(p)}`;
    const command = String(game.command || game.launchCommand || '').toLowerCase().replace(/"/g, '').trim();
    if (platform && command) return `${platform}:cmd:${_hashShort(command)}`;
    if (platform && game.name) return `${platform}:name:${normalizeDisplayName(game.name).toLowerCase()}`;
    return null;
}

function isGameInstallValid(game = {}) {
    const platform = normalizeScannerPlatform(game.scannerPlatform || game.platform);
    const warnings = [];
    const installPath = game.path || game.installPath;
    const exePath = game.executablePath;

    if (installPath) {
        if (!dirExists(installPath) && !fileExists(installPath)) {
            return { valid: false, reason: 'install_path_missing', validationWarnings: ['install path missing'] };
        }
    }

    if (exePath && !fileExists(exePath)) {
        return { valid: false, reason: 'exe_missing', validationWarnings: ['executable missing'] };
    }

    if (['riot', 'ubisoft', 'ea'].includes(platform) && !exePath) {
        return { valid: false, reason: 'exe_missing', validationWarnings: ['no verified game executable'] };
    }

    if (['steam', 'epic'].includes(platform) && !exePath && installPath && !dirHasUsefulFiles(installPath)) {
        return { valid: false, reason: 'install_path_empty', validationWarnings: ['install directory has no useful files'] };
    }

    if (platform === 'xbox' && installPath && !dirExists(installPath)) {
        return { valid: false, reason: 'install_path_missing', validationWarnings: ['package install location missing'] };
    }

    return { valid: true, reason: null, validationWarnings: warnings };
}

function withTimeout(promise, ms, platformName = 'scanner') {
    let timer = null;
    return Promise.race([
        Promise.resolve(promise),
        new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`${platformName} scan timed out after ${ms}ms`)), ms);
        })
    ]).finally(() => {
        if (timer) clearTimeout(timer);
    });
}


// ============================================================
// ENGINE CLASS
// ============================================================
class BaddelEngine {
    constructor(options = {}) {
        this.programData = options.programData || process.env.ProgramData || 'C:\\ProgramData';
        this.appData = options.appData || process.env.APPDATA || path.join(process.env.HOME || os.homedir(), 'AppData', 'Roaming');
        this.dbFolder = options.dbFolder || app.getPath('userData');
        this.dbPath = path.join(this.dbFolder, 'games-db.json');
        this.officialPaths = new Set();
        this.dbCache = [];
        this._saveTimer = null;
        this._currentScanReports = {};
        this._skipMetadataServerSync = !!options.skipMetadataServerSync;
        this._testDriveRoots = options.driveRoots || null;
        this._riotSearchRoots = options.riotSearchRoots || null;
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

    async flushDatabase() {
        if (this._saveTimer) {
            clearTimeout(this._saveTimer);
            this._saveTimer = null;
        }
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
    }

    // Async write with 500ms debounce to avoid blocking the main thread
    saveDatabase() {
        if (this._saveTimer) clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(async () => {
            this._saveTimer = null;
            await this.flushDatabase();
        }, 500);
    }

    // ============================================================
    // UPSERT
    // ============================================================
    async upsertGame(game) {
        if (!game.id) game.id = this.generateStableId(game);
        game.installedGameKey = game.installedGameKey || makeInstalledGameKey(game);

        const incomingCommand = (game.command || '').replace(/"/g, '').toLowerCase().trim();
        const index = this.dbCache.findIndex(g => {
            const existingKey = g.installedGameKey || makeInstalledGameKey(g);
            const existingCommand = (g.command || '').replace(/"/g, '').toLowerCase().trim();
            return g.id === game.id ||
                (game.installedGameKey && existingKey === game.installedGameKey) ||
                (incomingCommand && existingCommand && incomingCommand === existingCommand);
        });

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
                launchCommand: game.launchCommand || game.command || existing.launchCommand,
                installSource: game.installSource || existing.installSource,
                scannerPlatform: game.scannerPlatform || existing.scannerPlatform,
                launcherGameId: game.launcherGameId || existing.launcherGameId,
                installedGameKey: game.installedGameKey || existing.installedGameKey,
                executablePath: game.executablePath || existing.executablePath,
                exeCandidates: Array.isArray(game.exeCandidates) ? game.exeCandidates : existing.exeCandidates,
                allIds:       { ...(existing.allIds || {}), ...(game.allIds || {}) },
                namespace:    game.namespace    || existing.namespace,
                appName:      game.appName      || existing.appName,
                catalogNamespace: game.catalogNamespace || existing.catalogNamespace,
                catalogItemId: game.catalogItemId || existing.catalogItemId,
                packageFamilyName: game.packageFamilyName || existing.packageFamilyName,
                riotProduct:  game.riotProduct  || existing.riotProduct,
                scanSourceDetail: game.scanSourceDetail || existing.scanSourceDetail,
                validationWarnings: Array.isArray(game.validationWarnings) ? game.validationWarnings : (existing.validationWarnings || []),
                installVerified: game.installVerified ?? existing.installVerified,
                isInstalled: game.isInstalled ?? existing.isInstalled ?? true,
                firstSeenAt: existing.firstSeenAt || game.firstSeenAt || existing.addedAt,
                lastSeenAt: game.lastSeenAt || existing.lastSeenAt,
                removedFromDiskAt: game.isInstalled === false ? (game.removedFromDiskAt || existing.removedFromDiskAt) : null,
                missingReason: game.isInstalled === false ? (game.missingReason || existing.missingReason) : null,
                // ── Image field contract ─────────────────────────────────────────
                // Always prefer the richer / more recently loaded value.
                // A fresh scan may return null for image fields if the scanner did
                // not find art on this pass (e.g. Steam cover not yet cached).
                // Clobbering a good existing value with null is what causes the
                // Installed Games card to flip to hero+logo after a rescan.
                image:        game.image        || existing.image        || null,
                heroImage:    game.heroImage    || existing.heroImage    || null,
                logo:         game.logo         || existing.logo         || null,
                defaultImage: defImg            || existing.defaultImage || null,
                defaultHero:  defHero           || existing.defaultHero  || null,
                defaultLogo:  defLogo           || existing.defaultLogo  || null,
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
    const index = this.dbCache.findIndex(g => String(g.id) === String(gameId));
    if (index === -1) return { status: 'error', message: 'Game not found' };

    const game = this.dbCache[index];
    const oldName = game.name || game.title || '';

    if (!game.originalName && oldName && oldName !== newName) {
        game.originalName = oldName;
    }

    game.name = newName;
    game.title = newName;

    // Manual title override, separate from artwork lock
    game.customTitle = newName;
    game.customTitleLocked = true;
    game.titleSource = 'creator';
    game.titleUpdatedAt = Date.now();

    this.saveDatabase();

    return {
        status: 'success',
        newName,
        customTitleLocked: true,
        titleSource: 'creator',
        titleUpdatedAt: game.titleUpdatedAt
    };
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

    getStoredGames() { return this.dbCache.filter(g => !g.isHidden && g.isInstalled !== false); }
    getHiddenGames() { return this.dbCache.filter(g => g.isHidden); }
    getMissingInstalledGames() { return this.dbCache.filter(g => g.installSource === 'scanner' && g.isInstalled === false); }

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

    // Permanently remove Epic non-game entries (Fab assets, Unreal Marketplace
    // plugins, etc.) that were imported before the strict classifier existed.
    // Called after each Epic sync with the list of rejected/unknown entries.
    async removeEpicNonGameEntries(badEntries = []) {
        if (!Array.isArray(badEntries) || badEntries.length === 0) return { removed: 0 };

        const { isEpicSyncedGameAllowed } = require('./platformSyncShared');

        const normalize = v => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');

        const badAppNames = new Set(
            badEntries.map(e => normalize(e?.app_name)).filter(Boolean)
        );
        const badTitles = new Set(
            badEntries.map(e => normalize(e?.app_title || e?.title)).filter(Boolean)
        );

        const before = this.dbCache.length;
        const removed = [];

        this.dbCache = this.dbCache.filter(game => {
            const isEpic = game.platform === 'epic' || game.source === 'epic';
            if (!isEpic) return true;

            // Match by app_name or normalized title against the bad-entry lists.
            const gameAppName = normalize(game.appName || game.app_name);
            const gameTitle   = normalize(game.title || game.name);
            const gameId      = normalize(game.id);

            if ((gameAppName && badAppNames.has(gameAppName)) ||
                (gameTitle   && badTitles.has(gameTitle))     ||
                (gameId      && badAppNames.has(gameId))) {
                removed.push(game.id);
                return false;
            }

            // Also catch anything the classifier knows is bad.
            if (!isEpicSyncedGameAllowed(game)) {
                removed.push(game.id);
                return false;
            }

            return true;
        });

        if (removed.length > 0) {
            removed.forEach(id => this.deleteGameImages(id));
            this.saveDatabase();
            console.log(`[GameScanner] Removed ${removed.length} Epic non-game entries:`, removed);
        }

        return { removed: removed.length, ids: removed };
    }

    // ============================================================
    // IMAGES
    // ============================================================
    updateGameImage(gameId, newImagePath, type = 'cover') {
    const index = this.dbCache.findIndex(g => String(g.id) === String(gameId));
    if (index === -1) return { status: 'error', message: 'Game not found' };

    const game = this.dbCache[index];

    let finalPath = newImagePath;
    if (finalPath && !finalPath.startsWith('http') && !finalPath.startsWith('file://')) {
        finalPath = `file://${finalPath}`;
    }

    if (type === 'hero') {
        game.heroImage = finalPath;
    } else if (type === 'logo') {
        game.logo = finalPath;
    } else {
        game.image = finalPath;
    }

    // IMPORTANT: user changed artwork manually, so server/pipeline must not override it
    game.customArtworkLocked = true;
    game.artworkSource = 'creator';
    game.artworkUpdatedAt = Date.now();

    this.saveDatabase();
    return {
        status: 'success',
        path: finalPath,
        type,
        customArtworkLocked: true,
        artworkSource: 'creator',
        artworkUpdatedAt: game.artworkUpdatedAt
    };
}

    async resetGameImage(gameId, type = 'cover', opts = {}) {
    const index = this.dbCache.findIndex(g => String(g.id) === String(gameId));
    if (index === -1) return { status: 'error', message: 'Game not found' };

    const game = this.dbCache[index];
    const now = Date.now();

    const resetOne = (kind) => {
        let restoredPath = null;

        if (kind === 'hero') {
            restoredPath = game.defaultHero || this.findInCache(gameId, 'hero') || null;
            game.heroImage = restoredPath;
            return restoredPath;
        }

        if (kind === 'logo') {
            restoredPath = game.defaultLogo || this.findInCache(gameId, 'logo') || null;
            game.logo = restoredPath;
            return restoredPath;
        }

        restoredPath = game.defaultImage || this.findInCache(gameId, 'cover') || null;
        game.image = restoredPath;
        return restoredPath;
    };

    const resetAll = type === 'all' || opts.all === true;

    const result = {
        status: 'success',
        type,
        cover: null,
        hero: null,
        logo: null,
    };

    if (resetAll) {
        result.cover = resetOne('cover');
        result.hero = resetOne('hero');
        result.logo = resetOne('logo');

        // رجوع كامل لوضع launcher/server default
        game.customArtworkLocked = false;
        game.artworkSource = 'reset';
        game.artworkUpdatedAt = now;

        delete game.creatorOriginalCover;
        delete game.creatorOriginalHero;
        delete game.creatorOriginalLogo;
    } else {
        const restoredPath = resetOne(type);
        result.path = restoredPath;

        // reset single image لا يغيّر lock العام عشان ممكن يكون فيه صورة تانية custom
        game.artworkSource = game.customArtworkLocked ? 'creator' : 'reset';
        game.artworkUpdatedAt = now;
    }

    this.saveDatabase();
    return result;
}

    findInCache(gameId, type) {
        try {
            const cacheDir = path.join(this.dbFolder, 'image_cache');
            if (!fsSync.existsSync(cacheDir)) return null;
            const files = fsSync.readdirSync(cacheDir);
            const prefix = _cacheBaseName(type, gameId);
            const found = files.find(f => f.startsWith(prefix));
            return found ? `file://${path.join(cacheDir, found).replace(/\\/g, '/')}` : null;
        } catch { return null; }
    }

    deleteGameImages(gameId) {
        try {
            const cacheDir = path.join(this.dbFolder, 'image_cache');
            const files = fsSync.readdirSync(cacheDir);
            ['cover', 'hero', 'logo'].forEach(type => {
                const prefix = _cacheBaseName(type, gameId);
                files.filter(f => f.startsWith(prefix)).forEach(file => {
                    try { fsSync.unlinkSync(path.join(cacheDir, file)); } catch { /* ignore */ }
                });
            });
        } catch { /* ignore */ }
    }

    async downloadToCache(url, gameId, type) {
        // All image caching is now handled by baddelapi
        return url || null;
    }

    _platformReport(platform) {
        const key = normalizeScannerPlatform(platform);
        if (!this._currentScanReports[key]) {
            this._currentScanReports[key] = {
                platform: key,
                raw: 0,
                valid: 0,
                kept: 0,
                skipped: 0,
                skippedStale: 0,
                skippedMissingPath: 0,
                skippedMissingExe: 0,
                staleRemoved: 0,
                durationMs: 0,
                errors: [],
            };
        }
        return this._currentScanReports[key];
    }

    _recordRaw(platform, count = 1) {
        this._platformReport(platform).raw += count;
    }

    _recordValid(platform, count = 1) {
        const report = this._platformReport(platform);
        report.valid += count;
        report.kept += count;
    }

    _recordSkip(platform, reason, candidate = {}) {
        const report = this._platformReport(platform);
        report.skipped++;
        if (reason === 'install_path_missing') report.skippedMissingPath++;
        else if (reason === 'exe_missing') report.skippedMissingExe++;
        else if (reason === 'stale_registry_entry' || reason === 'install_path_empty') report.skippedStale++;
        if (platform === 'ubisoft') {
            console.log(`[Ubisoft Scan] SKIP stale registry entry "${candidate.name || candidate.Name || candidate.DisplayName || 'Unknown'}" ${reason} path=${candidate.path || candidate.Path || candidate.InstallDir || candidate.InstallLocation || ''}`);
        }
    }

    _recordError(platform, err) {
        this._platformReport(platform).errors.push(err?.message || String(err));
    }

    _scannerPlatformForGame(game = {}) {
        const platform = normalizeScannerPlatform(game.scannerPlatform || game.platform || game.source);
        if (SCANNER_PLATFORMS.has(platform)) return platform;

        const id = String(game.id || '').toLowerCase();
        if (id.startsWith('steam-')) return 'steam';
        if (id.startsWith('epic-')) return 'epic';
        if (id.startsWith('riot-')) return 'riot';
        if (id.startsWith('ubisoft-')) return 'ubisoft';
        if (id.startsWith('ea-')) return 'ea';
        if (id.startsWith('xbox-')) return 'xbox';
        return null;
    }

    _isScannerOwnedGame(game = {}) {
        if (game.installSource === 'scanner') return true;
        if (game.installSource && game.installSource !== 'scanner') return false;
        const platform = this._scannerPlatformForGame(game);
        if (!platform) return false;
        if (String(game.platform || '').toLowerCase() === 'manual') return false;
        return !!(game.command || game.path || game.launcherGameId || game.allIds);
    }

    _prepareScannerGame(game, platform, scanStartedAt) {
        const scannerPlatform = normalizeScannerPlatform(platform || game.scannerPlatform || game.platform);
        const validation = isGameInstallValid({ ...game, scannerPlatform });
        const prepared = {
            ...game,
            name: normalizeDisplayName(game.name || game.title),
            installSource: 'scanner',
            scannerPlatform,
            launchCommand: game.launchCommand || game.command || null,
            installVerified: validation.valid,
            isInstalled: validation.valid,
            firstSeenAt: game.firstSeenAt || scanStartedAt,
            lastSeenAt: scanStartedAt,
            scanSourceDetail: game.scanSourceDetail || scannerPlatform,
            validationWarnings: [
                ...(Array.isArray(game.validationWarnings) ? game.validationWarnings : []),
                ...(validation.validationWarnings || [])
            ],
        };
        prepared.installedGameKey = game.installedGameKey || makeInstalledGameKey(prepared);
        if (!prepared.launcherGameId) {
            if (scannerPlatform === 'steam') prepared.launcherGameId = prepared.allIds?.steam || String(prepared.id || '').replace(/^steam[-_]/i, '');
            if (scannerPlatform === 'epic') prepared.launcherGameId = [prepared.namespace || prepared.catalogNamespace, prepared.catalogItemId, prepared.appName].filter(Boolean).join(':');
            if (scannerPlatform === 'riot') prepared.launcherGameId = prepared.riotProduct;
            if (scannerPlatform === 'xbox') prepared.launcherGameId = prepared.packageFamilyName;
        }
        return { game: prepared, validation };
    }

    _preferDetectedCandidate(existing, candidate) {
        if (!existing) return candidate;
        const existingHasExe = !!existing.executablePath;
        const candidateHasExe = !!candidate.executablePath;
        if (candidateHasExe && !existingHasExe) return candidate;
        if (candidateHasExe === existingHasExe) {
            const existingPath = normalizePath(existing.path || '');
            const candidatePath = normalizePath(candidate.path || '');
            if (candidatePath && (!existingPath || candidatePath.length < existingPath.length)) return candidate;
        }
        return existing;
    }

    _missingReasonForStoredGame(game = {}) {
        // Epic non-game assets (Fab, Marketplace plugins, etc.) get a specific reason
        // so they can be distinguished from genuinely missing games.
        if (game.scannerPlatform === 'epic' || game.platform === 'Epic Games') {
            const { classifyEpicEntry } = require('./platformSyncShared');
            const { decision } = classifyEpicEntry({
                app_name:  game.appName || '',
                app_title: game.name   || '',
                title:     game.name   || '',
                namespace: game.namespace || game.catalogNamespace || '',
                metadata:  {},
            });
            if (decision === 'reject') return 'epic_non_game_asset';
        }
        if (game.path && !dirExists(game.path) && !fileExists(game.path)) return 'install_path_missing';
        if (game.executablePath && !fileExists(game.executablePath)) return 'exe_missing';
        return 'not_seen_in_latest_scan';
    }

    async _writeScanDiagnostics(report) {
        try {
            const dir = path.join(this.dbFolder, 'scan-diagnostics');
            await fs.mkdir(dir, { recursive: true });
            await fs.writeFile(path.join(dir, 'latest-scan.json'), JSON.stringify(report, null, 2), 'utf8');
        } catch (err) {
            console.warn('[GameScanner] Failed to write scan diagnostics:', err.message);
        }
    }

    async _getFilesystemDrives() {
        if (Array.isArray(this._testDriveRoots) && this._testDriveRoots.length > 0) return this._testDriveRoots;
        try {
            const { stdout } = await execAsync(
                'powershell -NoProfile -Command "Get-PSDrive -PSProvider FileSystem | Select-Object -ExpandProperty Name"',
                { timeout: 5000 }
            );
            const drives = stdout.split(/\r?\n/).map(d => d.trim()).filter(Boolean).map(d => `${d}:\\`);
            return drives.length ? drives : ['C:\\'];
        } catch {
            return ['C:\\'];
        }
    }

    _parseVdfValue(content, key) {
        const re = new RegExp(`"${key}"\\s+"((?:\\\\.|[^"\\\\])*)"`, 'i');
        const match = String(content || '').match(re);
        if (!match) return null;
        return match[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }

    _parseSteamLibraries(steamPath, content) {
        const libraries = new Set([_cleanPathInput(steamPath)]);
        const re = /"path"\s+"((?:\\.|[^"\\])*)"/gi;
        let match;
        while ((match = re.exec(String(content || '')))) {
            const lib = _cleanPathInput(match[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\'));
            if (lib) libraries.add(lib);
        }
        return [...libraries].filter(Boolean);
    }

    _isSteamUtilityApp(name) {
        const lower = String(name || '').toLowerCase();
        return [
            'steamworks common redistributables',
            'steam linux runtime',
            'proton ',
            'steamvr',
            'dedicated server',
            'sdk',
            'tool',
            'soundtrack'
        ].some(term => lower.includes(term));
    }

    _buildSteamGameFromManifest(appsPath, acf, sourceFile = '') {
        const name = normalizeDisplayName(this._parseVdfValue(acf, 'name'));
        const appid = this._parseVdfValue(acf, 'appid');
        const installdir = this._parseVdfValue(acf, 'installdir');
        const stateFlags = this._parseVdfValue(acf, 'StateFlags');
        this._recordRaw('steam');

        if (!name || !appid || this._isSteamUtilityApp(name)) {
            this._recordSkip('steam', 'not_game', { name });
            return null;
        }
        if (stateFlags && stateFlags !== '4') {
            this._recordSkip('steam', 'not_fully_installed', { name });
            return null;
        }

        const installDir = path.join(appsPath, 'common', installdir || name);
        if (!dirExists(installDir)) {
            this._recordSkip('steam', 'install_path_missing', { name, path: installDir });
            return null;
        }
        if (!dirHasUsefulFiles(installDir)) {
            this._recordSkip('steam', 'install_path_empty', { name, path: installDir });
            return null;
        }

        const exe = findLikelyGameExe(installDir, { nameHint: name, maxDepth: 5 });
        const game = {
            id: `steam-${appid}`,
            name,
            platform: 'Steam',
            scannerPlatform: 'steam',
            launcherGameId: String(appid),
            path: installDir,
            executablePath: exe || null,
            exeCandidates: exe ? [path.basename(exe)] : [],
            command: `steam://run/${appid}`,
            launchCommand: `steam://run/${appid}`,
            score: 100,
            needsUpdate: stateFlags !== '4',
            allIds: { steam: String(appid) },
            scanSourceDetail: sourceFile || 'steam_appmanifest',
        };
        game.installedGameKey = makeInstalledGameKey(game);
        this._recordValid('steam');
        return game;
    }

    _resolveEpicLaunchExecutable(installLocation, launchExecutable) {
        if (!launchExecutable) return null;
        const raw = String(launchExecutable).trim().replace(/^"+|"+$/g, '');
        const exePart = raw.match(/^(.*?\.exe)\b/i)?.[1] || raw;
        const clean = _cleanPathInput(exePart);
        if (!clean) return null;
        return path.isAbsolute(clean) ? clean : path.join(installLocation, clean);
    }

    _isEpicManifestIncomplete(data = {}) {
        const boolFields = ['bIsIncompleteInstall', 'IsIncompleteInstall', 'bNeedsRepair', 'NeedsRepair'];
        if (boolFields.some(k => data[k] === true || String(data[k]).toLowerCase() === 'true')) return true;
        const state = String(data.InstallState || data.install_state || '').toLowerCase();
        return !!state && !['installed', 'complete', 'ready'].includes(state);
    }

    _buildEpicGameFromManifest(data = {}, sourceFile = '') {
        this._recordRaw('epic');
        const { DisplayName, InstallLocation, CatalogNamespace, CatalogItemId, AppName, LaunchExecutable } = data;
        const name = normalizeDisplayName(DisplayName);
        if (!name || !CatalogNamespace || !CatalogItemId || !AppName) {
            this._recordSkip('epic', 'missing_required_fields', { name });
            return null;
        }

        // Reject Fab, Unreal Marketplace assets, plugins, and editor tools before
        // touching the filesystem — reuse the same classifier as Epic Sync.
        const { classifyEpicEntry } = require('./platformSyncShared');
        const classifierEntry = {
            app_name:        AppName,
            app_title:       name,
            title:           name,
            namespace:       CatalogNamespace,
            catalogNamespace: CatalogNamespace,
            catalogItemId:   CatalogItemId,
            executable:      LaunchExecutable || null,
            metadata:        data,
        };
        const { decision: classDecision } = classifyEpicEntry(classifierEntry);
        if (classDecision === 'reject') {
            const skipReason = /^fab$/i.test(AppName) || /fab/i.test(CatalogNamespace) || /marketplace/i.test(name)
                ? 'epic_fab_or_marketplace'
                : 'epic_non_game_asset';
            console.log(`[Epic Scan] SKIP non-game asset "${name}" reason=${skipReason}`);
            this._recordSkip('epic', skipReason, { name });
            return null;
        }

        if (this._isEpicManifestIncomplete(data)) {
            this._recordSkip('epic', 'not_fully_installed', { name });
            return null;
        }
        if (!InstallLocation || !dirExists(InstallLocation)) {
            this._recordSkip('epic', 'install_path_missing', { name, path: InstallLocation });
            return null;
        }

        const launchExe = this._resolveEpicLaunchExecutable(InstallLocation, LaunchExecutable);
        if (LaunchExecutable && (!launchExe || !fileExists(launchExe))) {
            this._recordSkip('epic', 'exe_missing', { name, path: launchExe || InstallLocation });
            return null;
        }
        if (!launchExe && !dirHasUsefulFiles(InstallLocation)) {
            this._recordSkip('epic', 'install_path_empty', { name, path: InstallLocation });
            return null;
        }

        const likelyExe = launchExe || findLikelyGameExe(InstallLocation, { nameHint: name, maxDepth: 5 });
        const launcherGameId = `${CatalogNamespace}:${CatalogItemId}:${AppName}`;
        const safeId = launcherGameId.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '');
        const game = {
            id: `epic-${safeId}`,
            name,
            platform: 'Epic Games',
            scannerPlatform: 'epic',
            launcherGameId,
            path: InstallLocation,
            executablePath: likelyExe || null,
            exeCandidates: likelyExe ? [path.basename(likelyExe)] : [],
            command: `com.epicgames.launcher://apps/${encodeURIComponent(AppName)}?action=launch&silent=true`,
            launchCommand: `com.epicgames.launcher://apps/${encodeURIComponent(AppName)}?action=launch&silent=true`,
            score: 100,
            namespace: CatalogNamespace,
            catalogNamespace: CatalogNamespace,
            catalogItemId: CatalogItemId,
            appName: AppName,
            allIds: { epic: CatalogNamespace },
            scanSourceDetail: sourceFile || 'epic_manifest',
        };
        game.installedGameKey = makeInstalledGameKey(game);
        this._recordValid('epic');
        return game;
    }

    _buildUbisoftGameFromCandidate(candidate = {}) {
        this._recordRaw('ubisoft');
        const appId = candidate.Id || candidate.id || candidate.AppId || candidate.GameId || null;
        const name = normalizeDisplayName(candidate.Name || candidate.DisplayName || candidate.Title);
        const installDir = _cleanPathInput(candidate.Path || candidate.InstallDir || candidate.InstallLocation);
        if (!name || /ubisoft connect|uplay/i.test(name)) {
            this._recordSkip('ubisoft', 'not_game', { name, path: installDir });
            return null;
        }
        if (!installDir || !dirExists(installDir)) {
            this._recordSkip('ubisoft', 'install_path_missing', { name, path: installDir });
            return null;
        }
        if (!dirHasUsefulFiles(installDir, { maxDepth: 2 })) {
            this._recordSkip('ubisoft', 'stale_registry_entry', { name, path: installDir });
            return null;
        }

        const exe = findLikelyGameExe(installDir, { nameHint: name, maxDepth: 6 });
        if (!exe) {
            this._recordSkip('ubisoft', 'exe_missing', { name, path: installDir });
            return null;
        }

        const game = {
            id: appId ? `ubisoft-${appId}` : `ubisoft-${_hashShort(normalizePath(installDir))}`,
            name,
            platform: 'Ubisoft Connect',
            scannerPlatform: 'ubisoft',
            launcherGameId: appId ? String(appId) : null,
            ubisoftAppId: appId ? String(appId) : null,
            path: installDir,
            executablePath: exe,
            exeCandidates: [path.basename(exe)],
            command: appId ? `uplay://launch/${appId}/0` : `"${exe}"`,
            launchCommand: appId ? `uplay://launch/${appId}/0` : `"${exe}"`,
            score: 100,
            allIds: appId ? { ubisoft: String(appId) } : {},
            scanSourceDetail: candidate.scanSourceDetail || 'ubisoft_registry',
        };
        game.installedGameKey = makeInstalledGameKey(game);
        this._recordValid('ubisoft');
        return game;
    }

    _buildEAGameFromCandidate(candidate = {}) {
        this._recordRaw('ea');
        const name = normalizeDisplayName(candidate.Name || candidate.DisplayName || candidate.Title);
        const installDir = _cleanPathInput(candidate.Path || candidate.InstallDir || candidate.InstallLocation);
        const appId = candidate.Id || candidate.AppId || candidate.ProductId || null;
        if (!name || /^(ea|origin|ea app|ea desktop)$/i.test(name) || /^ea\s+app\b/i.test(name) || /^ea\s+desktop\b/i.test(name)) {
            this._recordSkip('ea', 'not_game', { name, path: installDir });
            return null;
        }
        if (!installDir || !dirExists(installDir)) {
            this._recordSkip('ea', 'install_path_missing', { name, path: installDir });
            return null;
        }
        const exe = findLikelyGameExe(installDir, { nameHint: name, maxDepth: 6 });
        if (!exe) {
            this._recordSkip('ea', 'exe_missing', { name, path: installDir });
            return null;
        }
        const game = {
            id: appId ? `ea-${appId}` : `ea-${_hashShort(normalizePath(installDir))}`,
            name,
            platform: 'EA App',
            scannerPlatform: 'ea',
            launcherGameId: appId ? String(appId) : null,
            eaAppId: appId ? String(appId) : null,
            path: installDir,
            executablePath: exe,
            exeCandidates: [path.basename(exe)],
            command: candidate.LaunchCommand || `eadesktop://mobilehome/default`,
            launchCommand: candidate.LaunchCommand || `eadesktop://mobilehome/default`,
            score: 100,
            allIds: appId ? { ea: String(appId) } : {},
            scanSourceDetail: candidate.scanSourceDetail || 'ea_uninstall_registry',
        };
        game.installedGameKey = makeInstalledGameKey(game);
        this._recordValid('ea');
        return game;
    }

    // ============================================================
    // METADATA
    // ============================================================
    async updateGameMetadata(gameId, metadata, { source = 'server', force = false } = {}) {
        const index = this.dbCache.findIndex(g => String(g.id) === String(gameId));
        if (index === -1) return { status: 'error', message: 'Game not found' };
        const game = this.dbCache[index];

        // Priority hierarchy for artwork writes:
        //   1. creator        — always wins; sets customArtworkLocked
        //   2. server-details — wins over pipeline / addManual (Game Details explicit resolve)
        //   3. pipeline / addManual / server — lowest; blocked by the two levels above
        const artLocked      = game.customArtworkLocked === true;
        const serverVerified = game.artworkSource === 'server-details' && !!game.artworkUpdatedAt;

        const skipArt = !force && (
            // Creator-locked: block all non-creator automated sources (incl. server-details re-write)
            (artLocked && source !== 'creator') ||
            // Server-verified: block pipeline and addManual (allow fresh server / server-details / creator)
            (serverVerified && !artLocked && (source === 'pipeline' || source === 'addManual'))
        );
        if (skipArt) {
            console.log(`[updateGameMetadata] ${gameId}: skipping art overwrite (artLocked=${artLocked} serverVerified=${serverVerified}, source=${source})`);
        } else {
            // Accept both 'hero' and 'heroImage'
const hasHeroKey  = ('hero' in metadata) || ('heroImage' in metadata);
const hasCoverKey = ('cover' in metadata);

if ('name' in metadata) {
    const nextName = String(metadata.name || '').trim();
    if (nextName) {
        game.name = nextName;
    }
}

const hero = metadata.hero || metadata.heroImage || null;
const isCreator = source === 'creator';

if (hasHeroKey) {
    if (hero) {
        if (isCreator && !game.creatorOriginalHero) {
            game.creatorOriginalHero = game.defaultHero || game.heroImage || null;
        }

        game.heroImage = hero;

        if (!isCreator) {
            game.defaultHero = hero;
        }
    } else if (isCreator || force) {
        game.heroImage = game.creatorOriginalHero || game.defaultHero || null;
    }
}

if (hasCoverKey) {
    if (metadata.cover) {
        if (isCreator && !game.creatorOriginalCover) {
            game.creatorOriginalCover = game.defaultImage || game.image || null;
        }

        game.image = metadata.cover;

        if (!isCreator) {
            game.defaultImage = metadata.cover;
        }
    } else if (isCreator || force) {
        game.image = game.creatorOriginalCover || game.defaultImage || null;
    }
}

if ('logo' in metadata) {
    if (metadata.logo) {
        if (isCreator && !game.creatorOriginalLogo) {
            game.creatorOriginalLogo = game.defaultLogo || game.logo || null;
        }

        game.logo = metadata.logo;

        if (!isCreator) {
            game.defaultLogo = metadata.logo;
        }
    } else if (isCreator || force) {
        if (metadata.logo === null) {
            // Explicit null from creator = user cleared the logo entirely
            game.logo        = null;
            game.defaultLogo = null;
        } else {
            game.logo = game.creatorOriginalLogo || game.defaultLogo || null;
        }
    }
}
        }

        // Ownership / provenance fields — always applied regardless of art-lock
        if (metadata.customArtworkLocked !== undefined) {
            game.customArtworkLocked = !!metadata.customArtworkLocked;
        }

        if (metadata.artworkSource !== undefined) {
            game.artworkSource = metadata.artworkSource;
        }

        if (metadata.artworkUpdatedAt !== undefined) {
            game.artworkUpdatedAt = metadata.artworkUpdatedAt;
        }

        if (metadata.clearCreatorOriginals === true) {
            delete game.creatorOriginalCover;
            delete game.creatorOriginalHero;
            delete game.creatorOriginalLogo;
        }

        if (metadata.name !== undefined) {
            const nextName = String(metadata.name || '').trim();
            if (nextName) {
                game.name = nextName;
                game.title = nextName;
            }
        }

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
        if (game.timeTrackingEnabled === false) return { status: 'tracking_disabled' };

        game.totalPlaytime = (game.totalPlaytime || 0) + playedMinutes;
        game.lastPlayed = Date.now();

        if (!game.playSessions) game.playSessions = [];
        const today = new Date().toISOString().split('T')[0];
        const legacySession = game.playSessions.find(s => s.date === today && !s.startedAt);
        if (legacySession) legacySession.minutes = (legacySession.minutes || 0) + playedMinutes;
        else game.playSessions.push({ date: today, minutes: playedMinutes });

        this.saveDatabase();
        return {
            status: 'success',
            totalPlaytime: game.totalPlaytime,
            lastPlayed: game.lastPlayed,
            lastQualifiedPlayed: game.lastQualifiedPlayed,
            playSessions: game.playSessions
        };
    }

    /**
     * Save a rich end-of-session record and conditionally update lastQualifiedPlayed.
     *
     * sessionData fields:
     *   countedMinutes       – unsaved portion to add to totalPlaytime
     *   totalCountedMinutes  – full session counted time (for record)
     *   rawRuntimeMinutes    – full session observed runtime
     *   idleMinutes
     *   backgroundMinutes
     *   foregroundSeen       – bool: was the game ever in foreground
     *   confidence           – 'high'|'medium'|'low'|'legacy'|'suspicious'
     *   endReason
     *   startedAt, endedAt   – timestamps
     *   isQualified          – precomputed by caller
     */
    async saveQualifiedSession(gameId, sessionData) {
        const index = this.dbCache.findIndex(g => String(g.id) === String(gameId));
        if (index === -1) return { status: 'error', message: 'Game not found' };

        const game = this.dbCache[index];
        if (game.timeTrackingEnabled === false) return { status: 'tracking_disabled' };

        const {
            countedMinutes      = 0,
            totalCountedMinutes = countedMinutes,
            rawRuntimeMinutes   = 0,
            idleMinutes         = 0,
            backgroundMinutes   = 0,
            foregroundSeen      = false,
            confidence          = 'medium',
            endReason           = '',
            startedAt           = Date.now(),
            endedAt             = Date.now(),
            isQualified         = false,
        } = sessionData;

        // Accumulate totals
        if (countedMinutes > 0) {
            game.totalPlaytime      = (game.totalPlaytime      || 0) + countedMinutes;
            game.rawRuntimeMinutes  = (game.rawRuntimeMinutes  || 0) + rawRuntimeMinutes;
            game.idleMinutes        = (game.idleMinutes        || 0) + idleMinutes;
            game.backgroundMinutes  = (game.backgroundMinutes  || 0) + backgroundMinutes;
        }

        // Keep a diagnostic timestamp for all detected sessions,
        // but do NOT let unqualified/false-positive detections affect Jump Back In.
        game.lastDetectedPlayed = endedAt;

        if (isQualified) {
            game.lastPlayed = endedAt;
            game.lastQualifiedPlayed = endedAt;
        }

        // Rich session record
        if (!game.playSessions) game.playSessions = [];
        const today = new Date(endedAt).toISOString().split('T')[0];
        game.playSessions.push({
            date:               today,
            startedAt,
            endedAt,
            minutes:            totalCountedMinutes,
            countedMinutes:     totalCountedMinutes,
            rawRuntimeMinutes,
            idleMinutes,
            backgroundMinutes,
            foregroundSeen,
            confidence,
            endReason,
            qualified:          isQualified,
        });

        // Keep last 500 sessions
        if (game.playSessions.length > 500) {
            game.playSessions = game.playSessions.slice(-500);
        }

        this.saveDatabase();
        return {
            status:              'success',
            totalPlaytime:       game.totalPlaytime,
            lastPlayed:          game.lastPlayed,
            lastQualifiedPlayed: game.lastQualifiedPlayed,
            playSessions:        game.playSessions,
            sessionQualified:    isQualified,
        };
    }

    async setTimeTrackingEnabled(gameId, enabled) {
        try {
            const game = this.dbCache.find(g => String(g.id) === String(gameId));
            if (!game) return { status: 'error', error: 'Game not found', gameId };
            game.timeTrackingEnabled = !!enabled;
            this.saveDatabase();
            return { status: 'success', gameId, timeTrackingEnabled: game.timeTrackingEnabled };
        } catch (err) {
            return { status: 'error', error: err.message, gameId };
        }
    }

    getTimeTrackingEnabled(gameId) {
        try {
            const game = this.dbCache.find(g => String(g.id) === String(gameId));
            if (!game) return { status: 'error', error: 'Game not found', gameId };
            return { status: 'success', gameId, timeTrackingEnabled: game.timeTrackingEnabled !== false };
        } catch (err) {
            return { status: 'error', error: err.message, gameId };
        }
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

            const rawExeStem   = path.parse(exePath).name;
            const exeName      = rawExeStem.replace(/[-_]/g, ' ').trim();
            const parentFolder = path.basename(path.dirname(exePath)).replace(/[-_]/g, ' ').trim();

            // ── Search candidate order ─────────────────────────────────────────
            // Priority: parent folder (most human-readable) → custom name →
            // cleaned exe stem → raw exe stem (compact / camelCase).
            // Deduplication keeps the first occurrence of each unique name.
            const seen = new Set();
            const searchSteps = [
                { name: parentFolder, source: 'Folder Name' },
                { name: customName,   source: 'User Input'  },
                { name: exeName,      source: 'EXE Name'    },
                { name: rawExeStem,   source: 'Raw EXE Stem'},
            ].filter(s => {
                const n = s.name?.trim();
                if (!n || seen.has(n.toLowerCase())) return false;
                seen.add(n.toLowerCase());
                return true;
            });

            // Compute stable ID up-front so we can check MRM and dup-detect before
            // making any network calls.
            const tempId = this.generateStableId({ command: `"${exePath}"`, name: customName || exeName });

            // ── Duplicate / re-add check ───────────────────────────────────────
            const normalizedPath = path.normalize(exePath).toLowerCase().trim();
            const existingIndex = this.dbCache.findIndex(g =>
                path.normalize((g.command || '').replace(/"/g, '').trim()).toLowerCase() === normalizedPath
            );
            if (existingIndex > -1) {
                const existing = this.dbCache[existingIndex];
                if (existing.isHidden) { existing.isHidden = false; this.saveDatabase(); }
                return { status: 'success', game: existing };
            }

            const primaryTitle = customName || parentFolder || exeName;

            // Build slug helper for MRM candidates
            const _toSlug = str => (str || '').toLowerCase()
                .replace(/[''`™®©]/g, '')
                .replace(/[^a-z0-9\s-]/g, ' ')
                .replace(/\s+/g, '-')
                .replace(/-{2,}/g, '-')
                .replace(/^-+|-+$/g, '');

            // Build MRM candidates using the centralized generator so camelCase
            // splitting and franchise alias expansion are applied uniformly.
            const mrmCandidates = generateMetadataCandidates({
                name:       customName || parentFolder,
                folderName: parentFolder,
                exeName:    rawExeStem,
                pathHint:   exePath,
            });

            // ── Route ALL resolution through MRM ──────────────────────────────
            // MRM handles: Stage 1 DB lookups → Stage 2 transient resolver →
            // 429 cooldown → NOT_FOUND / AMBIGUOUS / RESOLVED persistence.
            let finalMetadata = null;
            let finalName     = primaryTitle;
            let validationDeferred = false;

            const mrmStatus = mrm.getStatus(tempId);

            if (mrmStatus === MRM_STATUS.COOLDOWN) {
                console.log(`[Manual Add] MRM cooldown active for "${primaryTitle}" — deferred`);
                validationDeferred = true;
            } else {
                console.log(`[Manual Add] MRM candidates for "${primaryTitle}": ${mrmCandidates.map(c => c.title || c.slug).join(', ')}`);
                const resolveResult = await mrm.resolve(tempId, {
                    candidates:  mrmCandidates,
                    title:       primaryTitle,
                    slug:        _toSlug(primaryTitle) || undefined,
                    exeName:     exeName     || undefined,
                    folderName:  parentFolder || undefined,
                    pathHint:    exePath     || undefined,
                });

                if (resolveResult) {
                    finalMetadata = resolveResult.meta;
                    if (!customName) finalName = resolveResult.matchedName || primaryTitle;
                    console.log(`[Manual Add] ✓ MRM resolved "${primaryTitle}" via ${resolveResult._resolveSource}`);
                } else {
                    // MRM returned null — check if a cooldown was just registered
                    if (mrm.getStatus(tempId) === MRM_STATUS.COOLDOWN) {
                        console.warn(`[Manual Add] MRM entered cooldown for "${primaryTitle}" — deferred`);
                        validationDeferred = true;
                    }
                }
            }
            const newGame = {
                id: tempId,
                name: finalName,
                command: `"${exePath}"`,
                platform: 'Manual',
                // Populate art from metadata immediately — avoids a blank card
                image:     finalMetadata?.cover     || finalMetadata?.image     || null,
                heroImage: finalMetadata?.heroImage || finalMetadata?.hero      || null,
                logo:      finalMetadata?.logo                                  || null,
                score: 100,
                isHidden: false,
                addedAt: new Date().toISOString(),
                // Flag for background pipeline: retry art resolution later
                ...(validationDeferred ? {
                    needsValidation:    true,
                    validationDeferred: true,
                    validationReason:   'manual_add_rate_limited',
                } : {}),
            };

            await this.upsertGame(newGame);
            this.saveDatabase();

            // ── Persist full structured metadata immediately ───────────────────
            // game-details.js reads from metadataCacheStore via loadFullMetadata().
            // Without this call the details page has no description, screenshots,
            // ratings, etc. even though the card already shows the poster.
            if (finalMetadata) {
                metadataCacheStore.save(tempId, finalName, 'Manual', finalMetadata)
                    .catch(err => console.warn('[Manual Add] Failed to persist full metadata:', err.message));
            }

            // Kick off background image download to local WebP cache
            if (finalMetadata) this.backgroundDownload(finalMetadata, tempId, notifyCallback, { source: 'addManual' });
            return { status: 'success', game: newGame };
        } catch (err) {
            console.error('[Manual Add]', err);
            return { status: 'error', message: err.message };
        }
    }

async backgroundDownload(metadata, gameId, notifyCallback = null, { source = 'pipeline' } = {}) {
        try {
            const [cover, hero, logo] = await Promise.all([
                metadata.cover ? this.downloadToCache(metadata.cover, gameId, 'cover') : null,
                metadata.hero  ? this.downloadToCache(metadata.hero,  gameId, 'hero')  : null,
                metadata.logo  ? this.downloadToCache(metadata.logo,  gameId, 'logo')  : null
            ]);

            const finalCover = cover || metadata.cover || null;
            const finalHero  = hero  || metadata.heroImage || metadata.hero || null;
            const finalLogo  = logo  || metadata.logo  || null;

            if (finalCover || finalHero || finalLogo) {
                await this.updateGameMetadata(gameId, {
                    cover: finalCover,
                    hero:  finalHero,
                    logo:  finalLogo,
                }, { source });

                // Re-persist the full metadata payload with local file:// paths
                // so that game-details.js (via loadFullMetadata) sees the locally
                // cached art instead of the remote CDN URL.
                const game = this.dbCache.find(g => g.id === gameId);
                if (game && metadata) {
                    const updatedMeta = {
                        ...metadata,
                        cover:     finalCover,
                        heroImage: finalHero,
                        hero:      finalHero,
                        logo:      finalLogo,
                    };
                    metadataCacheStore.save(gameId, game.name, game.platform, updatedMeta)
                        .catch(err => console.warn('[Background Download] Failed to re-persist metadata with local paths:', err.message));
                }

                // إرسال إشعار للواجهة بعد اكتمال التحميل تماماً
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
            const { stdout } = await execAsync(`powershell -NoProfile -Command "Get-ItemProperty 'HKCU:\\Software\\Valve\\Steam' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty SteamPath"`, { timeout: 10000 });
            const steamPath = stdout.trim();
            if (!steamPath) return [];

            const vdfPath = path.join(steamPath, 'steamapps', 'libraryfolders.vdf');
            const content = await fs.readFile(vdfPath, 'utf8').catch(() => '');
            const libraries = this._parseSteamLibraries(steamPath, content);

            for (const lib of libraries) {
                const appsPath = path.join(lib, 'steamapps');
                try {
                    const files = await fs.readdir(appsPath);
                    for (const file of files) {
                        if (!file.startsWith('appmanifest_') || !file.endsWith('.acf')) continue;
                        const acf = await fs.readFile(path.join(appsPath, file), 'utf8');
                        const game = this._buildSteamGameFromManifest(appsPath, acf, path.join(appsPath, file));
                        if (game) games.push(game);
                    }
                } catch (err) {
                    this._recordError('steam', err);
                }
            }
        } catch (err) {
            this._recordError('steam', err);
            console.error('[Steam Scan]', err);
        }
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
                const raw = await fs.readFile(path.join(root, file), 'utf8');
                const data = safeJsonParse(raw, null);
                if (!data) {
                    this._recordSkip('epic', 'invalid_manifest', { name: file });
                    continue;
                }

                const game = this._buildEpicGameFromManifest(data, path.join(root, file));
                if (game) {

                    // ─── Try to fetch official images from legendary metadata ───
                    try {
                        const legendaryMeta = await this._getLegendaryMetadata(game.appName);
                        if (legendaryMeta && legendaryMeta.metadata?.keyImages) {
                            const keyImages = legendaryMeta.metadata.keyImages;
                            game.image     = this._pickEpicCover(keyImages);
                            game.heroImage = this._pickEpicHero(keyImages);
                            game.logo      = this._pickEpicLogo(keyImages);
                        }
                    } catch { /* skip if legendary not installed */ }

                    games.push(game);
                }
            }
        } catch (err) {
            this._recordError('epic', err);
        }
        return games;
    }

    async _getLegendaryMetadata(appName) {
        try {
            const userData = this.dbFolder;
            const dirs = await fs.readdir(userData);
            const legendaryDirs = dirs.filter(d => d.startsWith('legendary-config-'));

            for (const dir of legendaryDirs) {
                const metaPath = path.join(userData, dir, 'metadata', `${appName}.json`);
                if (fsSync.existsSync(metaPath)) {
                    const raw = await fs.readFile(metaPath, 'utf8');
                    return JSON.parse(raw);
                }
            }
        } catch (err) {
            console.error('[Legendary Meta Helper] Error:', err.message);
        }
        return null;
    }

    _pickEpicCover(keyImages) {
        if (!Array.isArray(keyImages) || keyImages.length === 0) return null;
        const PREF = ['DieselGameBoxTall', 'DieselGameBox', 'OfferImageTall', 'Thumbnail'];
        for (const type of PREF) {
            const img = keyImages.find(k => k.type === type);
            if (img?.url) return img.url;
        }
        return keyImages[0]?.url || null;
    }

    _pickEpicHero(keyImages) {
        if (!Array.isArray(keyImages) || keyImages.length === 0) return null;
        const PREF = ['DieselGameBox', 'OfferImageWide', 'Featured', 'Thumbnail'];
        for (const type of PREF) {
            const img = keyImages.find((k) => k.type === type);
            if (img?.url) return img.url;
        }
        return null;
    }

    _pickEpicLogo(keyImages) {
        if (!Array.isArray(keyImages) || keyImages.length === 0) return null;
        const PREF = ['DieselLogo', 'Logo', 'OfferLogo'];
        for (const type of PREF) {
            const img = keyImages.find((k) => k.type === type);
            if (img?.url) return img.url;
        }
        return null;
    }

    // --- Riot Games ---
    // Win10 note: RiotClientServices.exe may not expose --launch-product in ps-list
    // cmd output due to the way Win10 creates child processes. We therefore also
    // include the real game EXE path so the playtime tracker can match directly.
    async getRiotGames() {
        const roots = new Map();
        const knownClientExes = new Set();

        const addRoot = (root) => {
            const clean = _cleanPathInput(root);
            const key = normalizePath(clean);
            if (key && !roots.has(key)) roots.set(key, clean);
        };
        const addClientExe = (exe) => {
            const clean = _cleanPathInput(exe);
            if (clean) knownClientExes.add(clean);
        };
        const riotBaseFromPath = (rawPath, productDir) => {
        const clean = _cleanPathInput(rawPath);
        if (!clean) return null;

        // Make matching separator-agnostic: works with Windows "\" and tests/Linux "/"
        const normalized = clean.replace(/[\\/]+/g, '\\');
        const lower = normalized.toLowerCase();
        const product = String(productDir || '').toLowerCase();

        const needle = `\\${product}\\`;
        const idx = lower.indexOf(needle);
        if (idx >= 0) return normalized.slice(0, idx);

        const tail = `\\${product}`;
        if (lower.endsWith(tail)) {
            return normalized.slice(0, lower.lastIndexOf(tail));
        }

        return null;
    };

        try {
            const raw = await fs.readFile(path.join(this.programData, 'Riot Games', 'RiotClientInstalls.json'), 'utf8');
            const data = safeJsonParse(raw, {});
            for (const key of ['rc_default', 'rc_live']) {
                if (data[key]) {
                    const client = _cleanPathInput(data[key]);
                    addClientExe(client);
                    if (client.toLowerCase().includes('\\riot client\\')) addRoot(client.slice(0, client.toLowerCase().indexOf('\\riot client\\')));
                    else addRoot(path.dirname(path.dirname(client)));
                }
            }
            const assoc = data.associated_client || {};
            for (const [rawKey, rawVal] of Object.entries(assoc)) {
                const key = String(rawKey || '').toLowerCase();
                const val = _cleanPathInput(String(rawVal || ''));
                if (!val) continue;
                if (key.includes('valorant') || val.toLowerCase().includes('\\valorant\\')) addRoot(riotBaseFromPath(val, 'VALORANT'));
                if (key.includes('league') || val.toLowerCase().includes('\\league of legends\\')) addRoot(riotBaseFromPath(val, 'League of Legends'));
                if (val.toLowerCase().includes('riotclientservices.exe')) addClientExe(val);
            }
        } catch { /* no Riot install metadata */ }

        if (Array.isArray(this._riotSearchRoots)) {
            this._riotSearchRoots.forEach(addRoot);
        } else {
            const drives = await this._getFilesystemDrives();
            for (const drive of drives) {
                addRoot(path.join(drive, 'Riot Games'));
                addRoot(path.join(drive, 'Program Files', 'Riot Games'));
                addRoot(path.join(drive, 'Program Files (x86)', 'Riot Games'));
            }
        }

        const findRiotClient = (root) => {
            for (const exe of knownClientExes) {
                if (fileExists(exe)) return exe;
            }
            const fallback = path.join(root, 'Riot Client', 'RiotClientServices.exe');
            return fileExists(fallback) ? fallback : null;
        };

        const buildValorant = (root) => {
            const productDir = path.join(root, 'VALORANT');
            const liveDir = path.join(productDir, 'live');
            this._recordRaw('riot');
            if (!dirExists(productDir) || !dirExists(liveDir)) {
                this._recordSkip('riot', 'install_path_missing', { name: 'VALORANT', path: productDir });
                return null;
            }
            const directExe = path.join(liveDir, 'VALORANT.exe');
            const shippingExe = path.join(liveDir, 'ShooterGame', 'Binaries', 'Win64', 'VALORANT-Win64-Shipping.exe');
            const realExe = findFirstExisting([shippingExe, directExe]) ||
                findLikelyGameExe(liveDir, {
                    preferredNames: ['VALORANT-Win64-Shipping.exe', 'VALORANT.exe'],
                    includeNamePatterns: [/^valorant.*\.exe$/i],
                    nameHint: 'VALORANT',
                    maxDepth: 7,
                });
            if (!realExe || !fileExists(realExe)) {
                this._recordSkip('riot', 'exe_missing', { name: 'VALORANT', path: productDir });
                return null;
            }
            const client = findRiotClient(root);
            const fallbackLaunch = fileExists(directExe) ? directExe : realExe;
            const command = client
                ? `"${client}" --launch-product=valorant --launch-patchline=live`
                : `"${fallbackLaunch}"`;
            const exeCandidates = [...new Set([
                path.basename(realExe),
                fileExists(shippingExe) ? path.basename(shippingExe) : null,
                fileExists(directExe) ? path.basename(directExe) : null,
            ].filter(Boolean))];
            const game = {
                id: 'riot-valorant',
                name: 'VALORANT',
                platform: 'Riot Games',
                scannerPlatform: 'riot',
                launcherGameId: 'valorant',
                riotProduct: 'valorant',
                path: productDir,
                executablePath: realExe,
                exeCandidates,
                command,
                launchCommand: command,
                score: 100,
                allIds: { riot: 'valorant' },
                scanSourceDetail: 'riot_client_installs_or_drive_scan',
            };
            game.installedGameKey = makeInstalledGameKey(game);
            this._recordValid('riot');
            return game;
        };

        const buildLeague = (root) => {
            const productDir = path.join(root, 'League of Legends');
            this._recordRaw('riot');
            if (!dirExists(productDir)) {
                this._recordSkip('riot', 'install_path_missing', { name: 'League of Legends', path: productDir });
                return null;
            }
            const leagueClient = path.join(productDir, 'LeagueClient.exe');
            const gameExe = path.join(productDir, 'Game', 'League of Legends.exe');
            const realExe = findFirstExisting([leagueClient, gameExe]);
            if (!realExe || !fileExists(realExe)) {
                this._recordSkip('riot', 'exe_missing', { name: 'League of Legends', path: productDir });
                return null;
            }
            const client = findRiotClient(root);
            const fallbackLaunch = fileExists(leagueClient) ? leagueClient : realExe;
            const command = client
                ? `"${client}" --launch-product=league_of_legends --launch-patchline=live`
                : `"${fallbackLaunch}"`;
            const leagueUx = path.join(productDir, 'LeagueClientUx.exe');
            const exeCandidates = [...new Set([
                fileExists(leagueClient) ? 'LeagueClient.exe' : null,
                fileExists(leagueUx) ? 'LeagueClientUx.exe' : null,
                fileExists(gameExe) ? 'League of Legends.exe' : null,
            ].filter(Boolean))];
            const game = {
                id: 'riot-league-of-legends',
                name: 'League of Legends',
                platform: 'Riot Games',
                scannerPlatform: 'riot',
                launcherGameId: 'league_of_legends',
                riotProduct: 'league_of_legends',
                path: productDir,
                executablePath: realExe,
                exeCandidates,
                command,
                launchCommand: command,
                score: 100,
                allIds: { riot: 'league_of_legends' },
                scanSourceDetail: 'riot_client_installs_or_drive_scan',
            };
            game.installedGameKey = makeInstalledGameKey(game);
            this._recordValid('riot');
            return game;
        };

        const byProduct = new Map();
        for (const root of roots.values()) {
            if (!dirExists(root)) continue;
            for (const candidate of [buildValorant(root), buildLeague(root)].filter(Boolean)) {
                const existing = byProduct.get(candidate.riotProduct);
                byProduct.set(candidate.riotProduct, this._preferDetectedCandidate(existing, candidate));
            }
        }

        return [...byProduct.values()];
    }

    // --- Ubisoft Connect ---
    async getUbisoftGames() {
        const games = [];
        // سكريبت احترافي بيقرأ المسار من ملفات يوبي سوفت الأصلية لو ملقاهوش في الويندوز
        const psScript = `$installs = @(); $u = 'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Uplay Install *'; $ubi = 'HKLM:\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher\\Installs'; Get-ItemProperty $u -ErrorAction SilentlyContinue | ForEach-Object { $id = $_.PSChildName.Replace('Uplay Install ', '').Trim(); $dir = $_.InstallLocation; if (-not $dir) { $dir = (Get-ItemProperty "$ubi\\$id" -Name InstallDir -ErrorAction SilentlyContinue).InstallDir }; if ($dir -or $_.DisplayName) { $installs += [PSCustomObject]@{ Id = $id; Name = $_.DisplayName; Path = $dir; Source = 'uninstall-registry' } } }; Get-ChildItem $ubi -ErrorAction SilentlyContinue | ForEach-Object { $id = Split-Path $_.PSChildName -Leaf; $p = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue; if ($p.InstallDir) { $installs += [PSCustomObject]@{ Id = $id; Name = $p.DisplayName; Path = $p.InstallDir; Source = 'launcher-installs-registry' } } }; $installs | ConvertTo-Json -Compress`;
        
        try {
            const { stdout } = await execAsync(`powershell -NoProfile -Command "${psScript}"`, { timeout: 15000 });
            if (!stdout?.trim()) return games;
            let installs = safeJsonParse(stdout, []);
            if (!Array.isArray(installs)) installs = [installs];
            
            const seen = new Set();
            installs.forEach(g => {
                const key = `${g.Id || ''}:${normalizePath(g.Path || '')}`;
                if (seen.has(key)) return;
                seen.add(key);
                const game = this._buildUbisoftGameFromCandidate({
                    ...g,
                    scanSourceDetail: g.Source || 'ubisoft_registry',
                });
                if (game) games.push(game);
            });
        } catch (err) {
            this._recordError('ubisoft', err);
            console.error('[Ubisoft Scan]', err);
        }
        return games;
    }

    // --- EA App ---
    async getEAGames() {
        const games = [];
        try {
            const psScript = `Get-ItemProperty 'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object { $_.Publisher -like '*Electronic Arts*' -or $_.Publisher -like '*EA Games*' -or $_.Publisher -like '*Origin*' } | Select-Object DisplayName, InstallLocation, DisplayIcon, Publisher, PSChildName | ConvertTo-Json -Compress`;
            const { stdout } = await execAsync(`powershell -NoProfile -Command "${psScript}"`, { timeout: 15000 });
            if (!stdout?.trim()) return games;
            let installs = safeJsonParse(stdout, []);
            if (!Array.isArray(installs)) installs = [installs];
            installs.forEach(g => {
                const game = this._buildEAGameFromCandidate({
                    ...g,
                    Id: g.PSChildName,
                    scanSourceDetail: 'ea_uninstall_registry',
                });
                if (game) games.push(game);
            });
        } catch (err) {
            this._recordError('ea', err);
            console.error('[EA Scan]', err);
        }
        return games;
    }

    // --- Xbox / Microsoft Store ---
    async getXboxGames() {
        const games = [];

        // ── BLOAT: package-name substrings that are never games ──────────────
        // NOTE: 'solitaire' / 'microsoftsolitaireCollection' intentionally absent —
        // Microsoft Solitaire Collection is a real game and is caught by EXCEPTIONS.
        const BLOAT = new Set([
            'bingnews', 'bingweather', 'xbox', 'xboxgamingoverlay',
            'xboxidentityprovider', 'xboxspeechtotext', 'microsoft.549981c3f5f10', 'microsoft.3dbuilder',
            'microsoft.windowsalarms', 'microsoftteams', 'microsoft.windowscommunicationsapps',
            'windowsmaps', 'messaging', 'windowscamera', 'zune', 'wallet', 'windowsfeedback',
            'getstarted', 'officehub', 'onenote', 'skype', 'windowsphone',
            'print3d', 'screensketch', 'yourconsole', 'xboxapp', 'mixedreality', 'holographic'
        ]);

        // ── EXCEPTIONS: display-name substrings that are always real games ───
        // Bypass BLOAT, pre-filter, and server validation — always kept immediately.
        const EXCEPTIONS = new Set([
            'minecraft', 'forza', 'halo', 'gears', 'sea of thieves', 'grounded',
            'microsoft jigsaw', 'microsoft solitaire', 'solitaire collection',
        ]);

        // ── PRE-FILTER: display-name substrings that are definitely not games ─
        // Applied to the human-readable display name AFTER the BLOAT pass.
        // These remove the long tail of Store junk before any server call.
        const JUNK_TERMS = [
            // System / Windows components
            'extension', 'runtime', 'installer', 'terminal', 'calculator',
            'sound recorder', 'media extensions', 'video extension', 'image extension',
            'quick assist', 'dev home', 'app runtime', 'purchase app', 'speech',
            'get help', 'your phone', 'gaming app',
            // Office / productivity / social
            'whiteboard', 'sticky notes', 'notes', 'notepad', 'paint', 'photos',
            'clipchamp', 'outlook', 'onedrive', 'onenote', 'copilot', 'family',
            'linkedin', 'whatsapp', 'instagram', 'facebook',
            // Browsers / dev tools
            'visual studio code', 'edge', ' ui ',
            // Store / system UI
            'store', 'widget', 'health',
            // AI / chat apps
            'chatgpt', 'chat gpt', 'open ai', 'openai', 'claude',
            // Automation / utilities
            'power automate', 'automate desktop', 'source',
            // Control panels / drivers
            'control panel', 'nvidia control panel',
            // Security
            'malwarebytes',
            // Document / PDF
            'adobe acrobat',
            // Random publisher junk (numeric/publisher-prefixed package names)
            'translucent tb', 'charles milette',
        ];

        /**
         * Normalise a display name for junk-term matching:
         *   • lowercase
         *   • replace any run of non-alphanumeric chars (punctuation, digits-as-separators) with a space
         *   • collapse whitespace
         *   • pad with spaces so whole-word boundary checks work for single-word terms
         */
        const _normalizeForFilter = (displayName) =>
            ' ' + displayName.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim() + ' ';

        /**
         * Returns true when the candidate should proceed to server validation.
         * Exceptions always pass. Everything matching a JUNK_TERMS phrase is rejected.
         */
        const isLikelyXboxGameCandidate = (displayName) => {
            const norm = _normalizeForFilter(displayName);
            // Exception fast-path — always a game regardless of name content.
            if ([...EXCEPTIONS].some(e => norm.includes(' ' + e + ' ') || norm.trim().includes(e))) return true;
            // Reject if any junk term appears as a whole word / phrase.
            return ![...JUNK_TERMS].some(t => norm.includes(t));
        };

        /** Derive a URL-friendly slug from a display name. */
        const _toSlug = (name) =>
            name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

        /** Return true when a normalised metadata object has at least one image. */
        const _hasImageAsset = (meta) => {
            if (!meta) return false;
            return !!(meta.cover || meta.heroImage || meta.logo || meta.image || meta.hero);
        };

        /**
         * Stage-2 plausibility gate.
         * Returns true when the title looks like it could be a real game title,
         * i.e. is worth spending a transient-resolve call on.
         *
         * Positive signals  → short clean title, recognisable franchise words
         * Negative signals  → utility prefixes, random publisher IDs, version strings,
         *                     long all-uppercase tokens, numeric-prefixed names
         */
        const _isPlausibleGameTitle = (displayName) => {
            const norm = displayName.trim();

            // Reject titles that start with digits (publisher IDs like "28017Charles …")
            if (/^\d/.test(norm)) return false;

            // Reject titles that contain a version string (v1.2, 2.0.1, etc.)
            if (/\bv?\d+\.\d+/.test(norm)) return false;

            // Reject all-caps tokens of 5+ chars that look like product codes
            // e.g. "NVCPL", "MSVCP", "VCREDIST" — but allow "FIFA", "NBA", "NHL"
            const tokens = norm.split(/\s+/);
            const longUpperTokens = tokens.filter(t => t.length >= 5 && t === t.toUpperCase() && /^[A-Z]+$/.test(t));
            if (longUpperTokens.length > 0) return false;

            // Reject if the normalised name contains utility-like terms that
            // somehow survived the JUNK_TERMS pass (second-layer safety net)
            const UTILITY_TERMS = [
                'desktop', 'helper', 'assistant', 'driver', 'plugin', 'addin',
                'redistributable', 'framework', 'package', 'update', 'patch',
            ];
            const lower = ' ' + norm.toLowerCase() + ' ';
            if (UTILITY_TERMS.some(t => lower.includes(` ${t} `) || lower.includes(` ${t}s `))) return false;

            // Reasonable title length: 2–60 chars
            if (norm.length < 2 || norm.length > 60) return false;

            return true;
        };

        try {
            // ── A) Package enumeration with privilege fallback ────────────────
            // Try -AllUsers first (requires elevation). If PowerShell throws an
            // access-denied / UnauthorizedAccessException, retry without -AllUsers.
            const PS_FILTER = `Where-Object { $_.IsFramework -eq $false -and $_.SignatureKind -ne 'System' } | Select-Object Name, PackageFamilyName, InstallLocation | ConvertTo-Json`;
            const PS_ALL    = `Get-AppxPackage -AllUsers | ${PS_FILTER}`;
            const PS_CUR    = `Get-AppxPackage | ${PS_FILTER}`;

            const _isAccessDenied = (err) => {
                const msg = (err?.message || err?.stderr || '').toLowerCase();
                return msg.includes('access is denied') ||
                       msg.includes('unauthorizedaccessexception') ||
                       msg.includes('access denied');
            };

            let stdout;
            let scanMode;

            try {
                ({ stdout } = await execAsync(`powershell -command "${PS_ALL}"`, { timeout: 30000 }));
                scanMode = 'all-users';
            } catch (err) {
                if (_isAccessDenied(err)) {
                    console.warn('[Xbox Scan] -AllUsers access denied — retrying as current user');
                    ({ stdout } = await execAsync(`powershell -command "${PS_CUR}"`, { timeout: 30000 }));
                    scanMode = 'current-user-fallback';
                } else {
                    throw err; // unexpected error — let the outer catch handle it
                }
            }

            console.log(`[Xbox Scan] mode=${scanMode}`);

            if (!stdout?.trim()) return [];
            let apps = JSON.parse(stdout);
            if (!Array.isArray(apps)) apps = [apps];

            const totalRaw = apps.length;
            const xboxReport = this._platformReport('xbox');
            xboxReport.raw = totalRaw;

            // ── BLOAT pass (package-name level) ──────────────────────────────
            const afterBloat = apps.filter(app => {
                const lower = app.Name.toLowerCase();
                const isException = [...EXCEPTIONS].some(e => lower.includes(e));
                if (isException) return true;
                return ![...BLOAT].some(b => lower.includes(b)) &&
                    !lower.includes('client') && !lower.includes('overlay') && !lower.includes('service');
            });

            const totalAfterBloat = afterBloat.length;

            const afterPathValidation = afterBloat.filter(app => {
                if (!app.InstallLocation || dirExists(app.InstallLocation)) return true;
                console.log(`[Xbox Scan] DROP missing InstallLocation "${app.Name}" path=${app.InstallLocation}`);
                return false;
            });
            const totalPathDropped = totalAfterBloat - afterPathValidation.length;

            // ── Map to display-name candidates ───────────────────────────────
            const allCandidates = afterPathValidation.map(app => ({
                name: app.Name
                    .replace(/Microsoft\./i, '')
                    .replace(/\./g, ' ')
                    .replace(/([a-z])([A-Z])/g, '$1 $2')
                    .trim(),
                packageFamilyName: app.PackageFamilyName,
                platform: 'Xbox / Store',
                scannerPlatform: 'xbox',
                installSource: 'scanner',
                launcherGameId: app.PackageFamilyName,
                path: app.InstallLocation,
                command: `explorer.exe shell:AppsFolder\\${app.PackageFamilyName}!App`,
                launchCommand: `explorer.exe shell:AppsFolder\\${app.PackageFamilyName}!App`,
                installVerified: true,
                isInstalled: true,
                allIds: { xbox: app.PackageFamilyName },
                scanSourceDetail: `appx-${scanMode}`,
                score: 90,
            }));
            allCandidates.forEach(c => {
                c.id = `xbox-${String(c.packageFamilyName || c.name).replace(/[^a-z0-9_-]+/gi, '-')}`;
                c.installedGameKey = makeInstalledGameKey(c);
            });

            // ── B) Local pre-filter (display-name level) ─────────────────────
            const candidates = [];
            let totalPrefilterDropped = 0;
            for (const c of allCandidates) {
                if (isLikelyXboxGameCandidate(c.name)) {
                    candidates.push(c);
                } else {
                    console.log(`[Xbox Scan] PREFILTER DROP junk "${c.name}"`);
                    totalPrefilterDropped++;
                }
            }
            const totalAfterPrefilter = candidates.length;

            // ── Priority sort: exception titles run FIRST ───────────────────
            // This guarantees Jigsaw / Solitaire consume a transient-resolve slot
            // before low-value Store candidates trigger a 429 for everyone.
            candidates.sort((a, b) => {
                const aEx = [...EXCEPTIONS].some(e => a.name.toLowerCase().includes(e));
                const bEx = [...EXCEPTIONS].some(e => b.name.toLowerCase().includes(e));
                return (bEx ? 1 : 0) - (aEx ? 1 : 0);
            });

            // ── Transient resolve budget (per scan pass) ──────────────────
            // Cap the number of POST /client/resolve-metadata calls in one Xbox
            // scan pass to 5.  Because exceptions are sorted to the front they
            // consume the budget before any low-value candidate can trigger 429.
            const TRANSIENT_BUDGET = 5;
            let   transientUsed    = 0;

            // ── Rate-limit state (shared across concurrent workers) ───────────
            // When the server returns 429, workers set rateLimitedUntil and stop
            // firing transient resolve calls for the rest of this scan pass.
            let rateLimitedUntil = 0;   // epoch ms; 0 = not rate-limited
            let rateLimitedAt    = null; // candidate name that triggered 429

            // ── Per-run validation cache ──────────────────────────────────────
            // Maps normalised display name → { action: 'keep'|'drop'|'defer', meta? }
            // Prevents re-hitting the server for the same title in one pass.
            const validationCache = new Map();

            // ── Deferred candidates (hidden from library this pass) ───────────
            // These are NOT pushed to `games`.  They can be retried by the
            // background metadata pipeline on the next scan / rescan.
            const deferredCandidates = [];

            let totalKept    = 0;
            let totalDropped = 0;
            let totalDeferred = 0;

            const CONCURRENCY = 3;
            let index = 0;

            // ── Per-candidate validation worker ──────────────────────────────
            const worker = async () => {
                while (index < candidates.length) {
                    const candidate = candidates[index++];
                    const nameLower = candidate.name.toLowerCase();
                    const cacheKey  = nameLower;

                    // ── Cache hit ─────────────────────────────────────────────
                    if (validationCache.has(cacheKey)) {
                        const cached = validationCache.get(cacheKey);
                        if (cached.action === 'keep') {
                            if (cached.meta) _hydrate(candidate, cached.meta);
                            games.push(candidate);
                            totalKept++;
                            console.log(`[Xbox Scan] KEEP cache-hit     "${candidate.name}"`);
                        } else if (cached.action === 'defer') {
                            _markDeferred(candidate, cached.reason || 'cached-defer');
                            deferredCandidates.push(candidate);
                            totalDeferred++;
                            console.log(`[Xbox Scan] DEFERRED hidden-from-library "${candidate.name}" (cache)`);
                        } else {
                            totalDropped++;
                            console.log(`[Xbox Scan] DROP cache-hit     "${candidate.name}"`);
                        }
                        continue;
                    }

                    // ── Fast-path: known-game exception ───────────────────────
                    // Exceptions are NEVER dropped, but we still run Stage 1 + 2
                    // so the card gets its cover/hero/logo.  The flag suppresses the
                    // drop gate at the end so a lookup miss still keeps the game.
                    const isException = [...EXCEPTIONS].some(e => nameLower.includes(e));
                    if (isException) {
                        console.log(`[Xbox Scan] EXCEPTION KEEP     "${candidate.name}" — attempting art hydration`);
                    }

                    // ── Stage 1: DB lookups (slug + title) ────────────────────
                    // Cheap GET requests — always attempt regardless of rate-limit state.
                    // Also compute the MRM key used for Stage 2 coordination.
                    const mrmKey = `xbox_candidate:${_toSlug(candidate.name) || candidate.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
                    let meta = null;
                    let stage1Error = false;

                    try {
                        // Stage 1a — slug lookup
                        const slug = _toSlug(candidate.name);
                        const slugResult = await baddelApi.lookupGame({ slug });
                        if (slugResult) {
                            const normalised = baddelApi.normalizeServerData(slugResult);
                            if (_hasImageAsset(normalised)) {
                                meta = normalised;
                                console.log(`[Xbox Scan] KEEP server-hit    "${candidate.name}" (slug)`);
                            }
                        }

                        // Stage 1b — title lookup (if slug missed)
                        if (!meta) {
                            const titleResult = await baddelApi.lookupGame({ title: candidate.name });
                            if (titleResult) {
                                const normalised = baddelApi.normalizeServerData(titleResult);
                                if (_hasImageAsset(normalised)) {
                                    meta = normalised;
                                    console.log(`[Xbox Scan] KEEP server-hit    "${candidate.name}" (title)`);
                                }
                            }
                        }
                    } catch (lookupErr) {
                        // Lookup network error — flag for deferred treatment below
                        console.warn(`[Xbox Scan] lookup error "${candidate.name}":`, lookupErr.message);
                        stage1Error = true;
                    }

                    // Stage 1 confirmed hit — keep immediately
                    if (meta) {
                        _hydrate(candidate, meta);
                        validationCache.set(cacheKey, { action: 'keep', meta });
                        games.push(candidate);
                        totalKept++;
                        // Persist hit in MRM so the background pipeline skips re-resolution
                        mrm.markResolved(mrmKey, { matchedName: candidate.name, resolveSource: 'server-hit' });
                        continue;
                    }

                    // ── Stage 1 network error — defer (exceptions still keep) ──
                    if (stage1Error) {
                        if (isException) {
                            // Never drop an exception — keep visible, flag for art retry
                            console.log(`[Xbox Scan] EXCEPTION KEEP (no-art) "${candidate.name}" (lookup network error — art deferred)`);
                            _markDeferred(candidate, 'exception_keep_pending_art');
                            validationCache.set(cacheKey, { action: 'keep', meta: null });
                            games.push(candidate);
                            totalKept++;
                        } else {
                            console.log(`[Xbox Scan] DEFERRED hidden-from-library "${candidate.name}" (lookup network error)`);
                            _markDeferred(candidate, 'network_error');
                            validationCache.set(cacheKey, { action: 'defer', reason: 'network_error' });
                            deferredCandidates.push(candidate);
                            totalDeferred++;
                        }
                        continue;
                    }

                    // ── Stage 2: Transient resolver ───────────────────────────
                    // Only if Stage 1 found nothing AND we are not rate-limited
                    // AND the title passes a plausibility check.
                    const now = Date.now();
                    const isRateLimited = rateLimitedUntil > now;

                    if (isRateLimited) {
                        if (isException) {
                            // Keep visible, flag for art retry on next pass
                            console.log(`[Xbox Scan] EXCEPTION KEEP (no-art) "${candidate.name}" (rate-limit active — art deferred)`);
                            _markDeferred(candidate, 'exception_keep_pending_art');
                            validationCache.set(cacheKey, { action: 'keep', meta: null });
                            games.push(candidate);
                            totalKept++;
                        } else {
                            // Non-exception — hide until validated
                            console.log(`[Xbox Scan] DEFERRED hidden-from-library "${candidate.name}" (rate-limit active)`);
                            _markDeferred(candidate, 'rate_limited');
                            validationCache.set(cacheKey, { action: 'defer', reason: 'rate_limited' });
                            deferredCandidates.push(candidate);
                            totalDeferred++;
                        }
                        continue;
                    }

                    if (!_isPlausibleGameTitle(candidate.name)) {
                        // Title failed plausibility gate — treat as confirmed non-game
                        console.log(`[Xbox Scan] DROP implausible-title "${candidate.name}"`);
                        validationCache.set(cacheKey, { action: 'drop' });
                        totalDropped++;
                        continue;
                    }

                    // ── MRM cross-session cooldown check ─────────────────────────────────
                    // If a previous scan pass (or pipeline run) recorded a 429 cooldown
                    // for this candidate, respect it without making another API call.
                    if (mrm.getStatus(mrmKey) === MRM_STATUS.COOLDOWN) {
                        if (isException) {
                            console.log(`[Xbox Scan] EXCEPTION KEEP (no-art) "${candidate.name}" (MRM cooldown active)`);
                            candidate.needsValidation    = true;
                            candidate.validationDeferred = true;
                            candidate.validationReason   = 'rate_limited_exception';
                            validationCache.set(cacheKey, { action: 'keep', meta: null });
                            games.push(candidate);
                            totalKept++;
                        } else {
                            console.log(`[Xbox Scan] DEFERRED "${candidate.name}" (MRM cooldown active)`);
                            _markDeferred(candidate, 'rate_limited');
                            validationCache.set(cacheKey, { action: 'defer', reason: 'rate_limited' });
                            deferredCandidates.push(candidate);
                            totalDeferred++;
                        }
                        continue;
                    }

                    // ── Transient budget gate ─────────────────────────────────────────
                    // Exceptions were sorted to the front so they always get a slot.
                    // Non-exceptions that arrive after the budget is exhausted are
                    // deferred to the background pipeline.
                    if (transientUsed >= TRANSIENT_BUDGET && !isException) {
                        console.log(`[Xbox Scan] DEFERRED (transient budget exhausted) "${candidate.name}"`);
                        _markDeferred(candidate, 'budget_exhausted');
                        validationCache.set(cacheKey, { action: 'defer', reason: 'budget_exhausted' });
                        deferredCandidates.push(candidate);
                        totalDeferred++;
                        continue;
                    }
                    transientUsed++;

                    // ── Stage 2: transient resolve via MRM ───────────────────────────────
                    // MRM handles: 429 cooldown persistence, NOT_FOUND/AMBIGUOUS state,
                    // inflight dedup, and cross-session retry prevention.
                    let resolveOutcome = 'pending'; // 'resolved'|'not_found'|'ambiguous'|'rate_limited'|'network_error'

                    const mrmResult = await mrm.resolve(mrmKey, {
                        title:        candidate.name,
                        platformHint: 'xbox',
                    });

                    if (mrmResult !== null) {
                        const normalised = mrmResult.meta;
                        if (_hasImageAsset(normalised)) {
                            meta = normalised;
                            resolveOutcome = 'resolved';
                        } else {
                            resolveOutcome = 'not_found';
                        }
                    } else {
                        // MRM returned null — inspect persisted status for outcome
                        const postStatus = mrm.getStatus(mrmKey);
                        if (postStatus === MRM_STATUS.COOLDOWN) {
                            const job = mrm.getJob(mrmKey);
                            if (job?.cooldownUntil) {
                                rateLimitedUntil = job.cooldownUntil;
                                rateLimitedAt    = candidate.name;
                            }
                            if (isException) {
                                candidate.needsValidation    = true;
                                candidate.validationDeferred = true;
                                candidate.validationReason   = 'rate_limited_exception';
                            }
                            console.warn(
                                `[Xbox Scan] RATE LIMITED via MRM — deferring remaining transient validations` +
                                ` (triggered by "${candidate.name}")`
                            );
                            resolveOutcome = 'rate_limited';
                        } else if (postStatus === MRM_STATUS.NOT_FOUND) {
                            resolveOutcome = 'not_found';
                        } else if (postStatus === MRM_STATUS.AMBIGUOUS) {
                            resolveOutcome = 'ambiguous';
                        } else {
                            // IDLE = network error or unexpected null — treat as network_error
                            resolveOutcome = 'network_error';
                        }
                    }

                    // ── Final keep / drop / defer decision ────────────────────
                    if (resolveOutcome === 'resolved' && meta) {
                        _hydrate(candidate, meta);
                        validationCache.set(cacheKey, { action: 'keep', meta });
                        games.push(candidate);
                        totalKept++;
                        console.log(`[Xbox Scan] KEEP transient-resolved "${candidate.name}" (cover=${!!candidate.image} hero=${!!candidate.heroImage} logo=${!!candidate.logo})`);

                    } else if (resolveOutcome === 'not_found' && !isException) {
                        // Server explicitly confirmed not a game — safe to drop.
                        // Exceptions are never dropped even on not_found.
                        validationCache.set(cacheKey, { action: 'drop' });
                        totalDropped++;
                        console.log(`[Xbox Scan] DROP confirmed-not-found "${candidate.name}"`);

                    } else if (isException) {
                        // Exception title with no art available right now — keep visible,
                        // background pipeline will backfill images later.
                        _markDeferred(candidate, 'exception_keep_pending_art');
                        validationCache.set(cacheKey, { action: 'keep', meta: null });
                        games.push(candidate);
                        totalKept++;
                        console.log(`[Xbox Scan] EXCEPTION KEEP (no-art) "${candidate.name}" (reason=${resolveOutcome} — art deferred to background pipeline)`);

                    } else {
                        // rate_limited | network_error | ambiguous →
                        // DEFER and hide from library (do NOT push to games)
                        const reason = resolveOutcome;
                        _markDeferred(candidate, reason);
                        validationCache.set(cacheKey, { action: 'defer', reason });
                        deferredCandidates.push(candidate);
                        totalDeferred++;
                        console.log(`[Xbox Scan] DEFERRED hidden-from-library "${candidate.name}" (reason=${reason})`);
                    }
                }
            };

            await Promise.all(Array.from({ length: CONCURRENCY }, worker));

            if (deferredCandidates.length > 0) {
                console.log(
                    `[Xbox Scan] Deferred (hidden) candidates: [${deferredCandidates.map(c => `"${c.name}"`).join(', ')}]`
                );
            }

            console.log(
                `[Xbox Scan] ══ Summary ══` +
                ` raw=${totalRaw}` +
                ` after-bloat=${totalAfterBloat}` +
                ` path-dropped=${totalPathDropped}` +
                ` after-prefilter=${totalAfterPrefilter}` +
                ` keptVisible=${totalKept}` +
                ` dropped=${totalDropped}` +
                ` deferredHidden=${totalDeferred}` +
                (rateLimitedAt ? ` rateLimitedAt="${rateLimitedAt}"` : '') +
                ` ══`
            );
            xboxReport.valid = totalKept;
            xboxReport.kept = totalKept;
            xboxReport.skipped = totalDropped + totalDeferred + totalPathDropped + totalPrefilterDropped;
            xboxReport.skippedMissingPath = totalPathDropped;

        } catch (err) {
            this._recordError('xbox', err);
            console.error('[Xbox Scan]', err);
        }
        return games;

        // ── Local helpers ─────────────────────────────────────────────────────

        /** Copy resolved image assets onto the candidate object. */
        function _hydrate(candidate, meta) {
            if (meta.cover     || meta.image)    candidate.image     = meta.cover     || meta.image     || null;
            if (meta.heroImage || meta.hero)      candidate.heroImage = meta.heroImage || meta.hero      || null;
            if (meta.logo)                        candidate.logo      = meta.logo;
        }

        /**
         * Mark a candidate as needing future validation.
         * The background metadata pipeline reads these flags and retries.
         */
        function _markDeferred(candidate, reason) {
            candidate.needsValidation    = true;
            candidate.validationDeferred = true;
            candidate.validationReason   = reason || 'unknown';
        }
    }

    // ============================================================
    // GLOBAL SCAN
    // ============================================================
    async startGlobalScan() {
        {
            const scanStartedAt = new Date().toISOString();
            const scanStartedMs = Date.now();
            this._currentScanReports = {};
            const scannedPlatforms = new Set();
            const scannerDefs = [
                { platform: 'steam', method: 'getSteamGames', timeoutMs: 30000 },
                { platform: 'epic', method: 'getEpicGames', timeoutMs: 30000 },
                { platform: 'riot', method: 'getRiotGames', timeoutMs: 30000 },
                { platform: 'ubisoft', method: 'getUbisoftGames', timeoutMs: 30000 },
                { platform: 'ea', method: 'getEAGames', timeoutMs: 30000 },
                { platform: 'xbox', method: 'getXboxGames', timeoutMs: 45000 },
            ];

            const official = [];
            await Promise.all(scannerDefs.map(async ({ platform, method, timeoutMs }) => {
                const started = Date.now();
                const report = this._platformReport(platform);
                try {
                    const games = await withTimeout(Promise.resolve().then(() => this[method]()), timeoutMs, platform);
                    report.durationMs = Date.now() - started;
                    scannedPlatforms.add(platform);
                    official.push(...(Array.isArray(games) ? games : []));
                } catch (err) {
                    report.durationMs = Date.now() - started;
                    this._recordError(platform, err);
                    console.warn(`[GameScanner] ${platform} scan failed:`, err.message);
                }
            }));

            const detectedMap = new Map();
            for (const rawGame of official) {
                const platform = normalizeScannerPlatform(rawGame.scannerPlatform || rawGame.platform);
                const { game, validation } = this._prepareScannerGame(rawGame, platform, scanStartedAt);
                if (!validation.valid) {
                    this._recordSkip(platform, validation.reason || 'invalid', game);
                    continue;
                }
                const key = makeInstalledGameKey(game);
                if (!key) {
                    this._recordSkip(platform, 'missing_stable_key', game);
                    continue;
                }
                game.installedGameKey = key;
                detectedMap.set(key, this._preferDetectedCandidate(detectedMap.get(key), game));
            }

            const detectedGames = [...detectedMap.values()];
            const detectedKeys = new Set(detectedMap.keys());
            for (const game of detectedGames) {
                try {
                    await this.upsertGame(game);
                } catch (err) {
                    this._recordError(game.scannerPlatform || 'unknown', err);
                }
            }

            let totalStaleRemoved = 0;
            for (const game of this.dbCache) {
                const platform = this._scannerPlatformForGame(game);
                if (!platform || !scannedPlatforms.has(platform)) continue;
                if (!this._isScannerOwnedGame(game)) continue;
                const key = game.installedGameKey || makeInstalledGameKey(game);
                if (key && detectedKeys.has(key)) continue;

                const reason = this._missingReasonForStoredGame(game);
                const wasVisible = game.isInstalled !== false;
                game.installSource = 'scanner';
                game.scannerPlatform = platform;
                game.installedGameKey = key || game.installedGameKey;
                game.isInstalled = false;
                game.installVerified = false;
                game.removedFromDiskAt = game.removedFromDiskAt || scanStartedAt;
                game.lastMissingScanAt = scanStartedAt;
                game.missingReason = reason;
                game.validationWarnings = [...new Set([...(game.validationWarnings || []), reason])];
                if (wasVisible) {
                    totalStaleRemoved++;
                    this._platformReport(platform).staleRemoved++;
                    console.log(`[GameScanner] Missing game hidden: ${game.name} reason=${reason} oldPath=${game.path || game.executablePath || ''}`);
                }
            }

            await this.flushDatabase();

            const scanFinishedAt = new Date().toISOString();
            const diagnostics = {
                scanStartedAt,
                scanFinishedAt,
                durationMs: Date.now() - scanStartedMs,
                rawDetected: official.length,
                uniqueDetected: detectedGames.length,
                staleRemoved: totalStaleRemoved,
                scannedPlatforms: [...scannedPlatforms],
                platforms: this._currentScanReports,
                visibleGamesAfterScan: this.getStoredGames().length,
            };
            await this._writeScanDiagnostics(diagnostics);

            for (const platform of Object.keys(this._currentScanReports)) {
                const r = this._currentScanReports[platform];
                console.log(`[GameScanner] Summary platform=${platform} raw=${r.raw} valid=${r.valid} skipped=${r.skipped} staleRemoved=${r.staleRemoved} durationMs=${r.durationMs}`);
            }

            if (!this._skipMetadataServerSync) {
                try {
                    const steamGames = detectedGames
                        .filter(g => g.scannerPlatform === 'steam')
                        .map(g => {
                            const id = g.allIds?.steam || String(g.id).replace(/^steam[-_]/i, '');
                            return { id, title: g.name, slug: g.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') };
                        })
                        .filter(g => /^\d+$/.test(g.id));

                    if (steamGames.length > 0) {
                        console.log(`[GameScanner] Syncing ${steamGames.length} Steam games to metadata server`);
                        baddelApi.importGames('steam', steamGames).catch(err =>
                            console.warn('[GameScanner] Failed to sync Steam games:', err.message)
                        );
                    } else {
                        console.log('[GameScanner] No Steam games found to sync');
                    }

                    const epicGames = detectedGames
                        .filter(g => g.scannerPlatform === 'epic')
                        .map(g => {
                            const id = g.allIds?.epic || g.namespace || null;
                            return id ? { id, title: g.name, slug: g.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), cover_url: g.image || null, hero_url: g.heroImage || null } : null;
                        })
                        .filter(g => {
                            if (!g) return false;
                            const valid = g.id.length >= 10 && /^[a-f0-9\-]+$/i.test(g.id);
                            if (!valid) console.warn(`[GameScanner] Epic game "${g.title}" - invalid namespace "${g.id}", skipping server sync`);
                            return valid;
                        });

                    if (epicGames.length > 0) {
                        console.log(`[GameScanner] Syncing ${epicGames.length} Epic games to metadata server`);
                        baddelApi.importGames('epic', epicGames).catch(err =>
                            console.warn('[GameScanner] Failed to sync Epic games:', err.message)
                        );
                    } else {
                        console.log('[GameScanner] No Epic games with valid namespaces found to sync');
                    }
                } catch (err) {
                    console.warn('[GameScanner] Metadata server sync error:', err.message);
                }
            }

            return this.getStoredGames();
        }
        
        // ─── Sync Steam & Epic games to metadata server ───
        try {
            // Extract Steam games
            const steamGames = official
                .filter(g => g.platform === 'Steam')
                .map(g => {
                    // Use allIds.steam (set at scan time) — always a clean numeric appid
                    const id = g.allIds?.steam || String(g.id).replace(/^steam[-_]/i, '');
                    return { id, title: g.name, slug: g.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') };
                })
                .filter(g => /^\d+$/.test(g.id)); // guard: only numeric appids are valid

            if (steamGames.length > 0) {
                console.log(`[GameScanner] Syncing ${steamGames.length} Steam games to metadata server`);
                baddelApi.importGames('steam', steamGames).catch(err =>
                    console.warn('[GameScanner] Failed to sync Steam games:', err.message)
                );
            } else {
                console.log('[GameScanner] No Steam games found to sync');
            }

            // ─── Sync Epic games to metadata server (namespace only — never AppName) ─
            const epicGames = official
                .filter(g => g.platform === 'Epic Games' || g.platform === 'Epic')
                .map(g => {
                    // Use allIds.epic (CatalogNamespace set at scan time)
                    const id = g.allIds?.epic || g.namespace || null;
                    return id ? { id, title: g.name, slug: g.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), cover_url: g.image || null, hero_url: g.heroImage || null } : null;
                })
                .filter(g => {
                    if (!g) return false;
                    // Validate: namespace must be a hex UUID, not an appName like 'Sugar'
                    const valid = g.id.length >= 10 && /^[a-f0-9\-]+$/i.test(g.id);
                    if (!valid) console.warn(`[GameScanner] Epic game "${g.title}" — invalid namespace "${g.id}", skipping server sync`);
                    return valid;
                });

            if (epicGames.length > 0) {
                console.log(`[GameScanner] Syncing ${epicGames.length} Epic games to metadata server`);
                baddelApi.importGames('epic', epicGames).catch(err =>
                    console.warn('[GameScanner] Failed to sync Epic games:', err.message)
                );
            } else {
                console.log('[GameScanner] No Epic games with valid namespaces found to sync');
            }
        } catch (err) {
            console.warn('[GameScanner] Metadata server sync error:', err.message);
        }
        
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
        if (!game.isHidden && !game.customArtworkLocked) {
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
                    // Try to fetch from Baddel metadata server by title
                    const meta = await baddelApi.lookupGame({ title: game.name });
                    if (meta && meta.images) {
                        const coverImg = meta.images.find(i => i.image_type === 'cover');
                        if (coverImg) {
                            const coverUrl = coverImg.cdn_url || coverImg.url;
                            if (coverUrl) {
                                await engine.backgroundDownload({ cover: coverUrl }, game.id, notifyCallback, { source: 'pipeline' });
                                updated = true;
                            }
                        }
                    }
                } catch (e) { /* skip */ }
            }
        }
    }
    if (updated) engine.saveDatabase();
}

// ============================================================
// METADATA CACHE STORE
// Full structured metadata fallback cache — separate from games-db.json
// Keyed by game.id; stores rich fields (description, screenshots, etc.)
// ============================================================
// ============================================================
// METADATA CACHE STORE
// Full structured metadata fallback cache — separate from games-db.json
// Canonicalizes Steam ids so steam-860510 and steam_860510 share one entry.
// ============================================================

function normalizeMetadataCacheKey(gameId) {
    const raw = String(gameId || '').trim();

    // Steam installed sometimes uses steam-APPID,
    // All Games sometimes uses steam_APPID.
    // Force both to one canonical cache key.
    const steam = raw.match(/^steam[-_](\d+)$/i);
    if (steam) return `steam_${steam[1]}`;

    return raw;
}

function metadataCacheAliases(gameId) {
    const raw = String(gameId || '').trim();
    const keys = new Set();

    if (raw) keys.add(raw);

    const canonical = normalizeMetadataCacheKey(raw);
    if (canonical) keys.add(canonical);

    const steam = raw.match(/^steam[-_](\d+)$/i);
    if (steam) {
        keys.add(`steam-${steam[1]}`);
        keys.add(`steam_${steam[1]}`);
    }

    return [...keys].filter(Boolean);
}

function isHollowMetadata(meta) {
    if (!meta || typeof meta !== 'object') return true;

    const info = meta.info || {};
    const screenshots = Array.isArray(info.screenshots) ? info.screenshots : [];
    const trailers = Array.isArray(info.allTrailers) ? info.allTrailers : [];
    const genres = Array.isArray(info.genres) ? info.genres : [];
    const ratingSources = Array.isArray(meta?.quality?.sources?.ratings)
        ? meta.quality.sources.ratings
        : Array.isArray(meta?.ratings?.sources)
            ? meta.ratings.sources
            : [];

    return !(
        info.description ||
        meta.description ||
        info.short_description ||
        meta.short_description ||
        meta.quality?.sources?.text ||
        screenshots.length ||
        trailers.length ||
        genres.length ||
        ratingSources.length
    );
}

class MetadataCacheStore {
    constructor(dbFolder) {
        this.cachePath = path.join(dbFolder, 'metadata-cache.json');
        this._cache = null; // loaded lazily
    }

    async _load() {
        if (this._cache !== null) return;
        try {
            const raw = await fs.readFile(this.cachePath, 'utf8');
            this._cache = JSON.parse(raw);
        } catch {
            this._cache = {};
        }
    }

    async _flush() {
        try {
            await fs.writeFile(this.cachePath, JSON.stringify(this._cache, null, 2), 'utf8');
        } catch (err) {
            console.warn('[MetadataCacheStore] flush error:', err.message);
        }
    }

    async save(gameId, title, platform, meta) {
        await this._load();

        const key = normalizeMetadataCacheKey(gameId);

        this._cache[key] = {
            gameId: key,
            originalGameId: String(gameId || ''),
            title: title || null,
            platform: platform || null,
            fetchedAt: Date.now(),
            source: 'fallback-getMetadata',
            meta,
        };

        // Remove old duplicate aliases like steam-860510
        // so the app cannot read the wrong/hollow cache later.
        for (const alias of metadataCacheAliases(gameId)) {
            if (alias !== key && this._cache[alias]) {
                delete this._cache[alias];
                console.log(`[MetadataCacheStore] Removed duplicate alias cache key=${alias}; canonical=${key}`);
            }
        }

        await this._flush();

        console.log(`[MetadataCacheStore] Persisted fallback metadata for gameId=${key} ("${title}")`);
        return { status: 'success' };
    }

    async load(gameId) {
        await this._load();

        const canonicalKey = normalizeMetadataCacheKey(gameId);
        const aliases = metadataCacheAliases(gameId);

        for (const key of [canonicalKey, ...aliases.filter(k => k !== canonicalKey)]) {
            const entry = this._cache[key] || null;
            if (!entry) continue;

            const meta = entry.meta || null;

            // If the found entry is hollow/empty, delete it and keep searching aliases.
            if (isHollowMetadata(meta)) {
                console.warn(`[MetadataCacheStore] Ignoring hollow cached metadata for gameId=${key} ("${entry.title || ''}")`);
                delete this._cache[key];
                await this._flush();
                continue;
            }

            // If found under old key steam-xxxx, migrate it to steam_xxxx.
            if (key !== canonicalKey) {
                this._cache[canonicalKey] = {
                    ...entry,
                    gameId: canonicalKey,
                    originalGameId: entry.originalGameId || String(gameId || ''),
                };

                delete this._cache[key];
                await this._flush();

                console.log(`[MetadataCacheStore] Migrated metadata cache ${key} -> ${canonicalKey}`);
            }

            console.log(
                `[MetadataCacheStore] Loaded cached fallback metadata for gameId=${canonicalKey} ` +
                `("${entry.title}") fetchedAt=${new Date(entry.fetchedAt || Date.now()).toISOString()}`
            );

            return meta;
        }

        return null;
    }

    // Returns the full entry with title, fetchedAt, etc. — used by main.js
    async getEntry(gameId) {
        await this._load();

        const canonicalKey = normalizeMetadataCacheKey(gameId);
        const aliases = metadataCacheAliases(gameId);

        for (const key of [canonicalKey, ...aliases.filter(k => k !== canonicalKey)]) {
            const entry = this._cache[key] || null;
            if (!entry) continue;

            if (isHollowMetadata(entry.meta)) {
                delete this._cache[key];
                await this._flush();
                continue;
            }

            if (key !== canonicalKey) {
                this._cache[canonicalKey] = {
                    ...entry,
                    gameId: canonicalKey,
                    originalGameId: entry.originalGameId || String(gameId || ''),
                };

                delete this._cache[key];
                await this._flush();
            }

            return this._cache[canonicalKey];
        }

        return null;
    }

    // Check if we already have a non-stale entry.
    async hasEntry(gameId, maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
        const entry = await this.getEntry(gameId);
        if (!entry) return false;
        return (Date.now() - (entry.fetchedAt || 0)) < maxAgeMs;
    }

    // Remove stale/incomplete entry and all aliases.
    async deleteEntry(gameId) {
        await this._load();

        let changed = false;

        for (const key of metadataCacheAliases(gameId)) {
            if (this._cache[key]) {
                delete this._cache[key];
                changed = true;
                console.log(`[MetadataCacheStore] Deleted metadata cache key=${key}`);
            }
        }

        if (changed) await this._flush();
    }
}

const metadataCacheStore = new MetadataCacheStore(app.getPath('userData'));

// Single coordinator for all non-Steam/Epic metadata resolution.
// Replaces the old _resolveThrottleMap + scattered cooldown checks.
const mrm = new MetadataResolutionManager(app.getPath('userData'));
mrm.setApi(baddelApi);

// ============================================================
// BACKGROUND METADATA PIPELINE
// ============================================================
// Runs after every scan for non-Steam/Epic games.
// For each such game:
//   1. Try server lookup by slug
//   2. Try server lookup by title
//   3. If server hits → cache assets + persist full metadata
//   4. If server misses → call local resolver (getMetadataLocal) + persist
//
// `getMetadataLocal` is injected from main.js at startup to avoid circular
// dependency. Call `registerLocalMetadataResolver(fn)` once during app init.
// ============================================================

/** @type {((gameName: string, hints: object) => Promise<object|null>) | null} */
let _localMetadataResolver = null;

/**
 * Register the local metadata resolver (the same logic powering get-game-metadata IPC).
 * Called once from main.js after the IPC handlers are set up.
 * @param {(gameName: string, hints: object) => Promise<object|null>} fn
 */
function registerLocalMetadataResolver(fn) {
    _localMetadataResolver = fn;
    console.log('[BackgroundMetaPipeline] Local metadata resolver registered.');
}

/**
 * Derive a clean slug from a game title (same logic as game-details.js).
 * @param {string} name
 * @returns {{ slug: string|null, title: string }}
 */
function _resolveGenericLookup(name) {
    if (!name) return { slug: null, title: name };
    const slug = name
        .toLowerCase()
        .trim()
        .replace(/[''`™®©]/g, '')
        .replace(/[^a-z0-9\s\-]/g, ' ')
        .replace(/\s+/g, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^-+|-+$/g, '');
    const validSlug = (slug && slug.length >= 3 && !/^\d+$/.test(slug)) ? slug : null;
    return { slug: validSlug, title: name };
}

/** Platforms that use the Steam/Epic server enrich flow — skip from this pipeline. */
const _SERVER_ENRICH_PLATFORMS = new Set(['steam', 'Steam', 'epic', 'Epic Games', 'epic games']);

/**
 * Run the background metadata pipeline for all installed non-Steam/Epic games.
 * Safe to call multiple times — skips games that already have persisted metadata
 * less than 7 days old and skips games that are already covered by the server
 * enrich pipeline.
 *
 * @param {object[]} games       - array of installed game records from the DB
 * @param {object}   imageCache  - the IPC-layer image cache helper (optional)
 */
async function runBackgroundMetadataPipeline(games) {
    const TAG = '[BackgroundMetaPipeline]';

    // Filter: only non-Steam/Epic installed games
    const targets = games.filter(g => {
        const plat = (g.platform || '').trim();
        return !_SERVER_ENRICH_PLATFORMS.has(plat) && !g.isHidden;
    });

    if (targets.length === 0) {
        console.log(`${TAG} No non-Steam/Epic games to process. Pipeline skipped.`);
        return;
    }

    console.log(`${TAG} ══════ Pipeline START — ${targets.length} game(s) to process ══════`);

    let resolved = 0, mrmSkipped = 0, skipped = 0, missed = 0, recovered = 0;

    for (const game of targets) {
        const gameTag = `${TAG}[${game.name}]`;

        // ── Art presence helpers ──────────────────────────────────────────────
        const hasDiskCover = !!engine.findInCache(game.id, 'cover');
        const hasDiskHero  = !!engine.findInCache(game.id, 'hero');
        const hasDiskLogo  = !!engine.findInCache(game.id, 'logo');
        const hasDbArt     = !!(game.image || game.heroImage || game.logo);
        const hasDiskArt   = hasDiskCover || hasDiskHero;
        const hasAnyArt    = hasDbArt || hasDiskArt;
        const hasDbHero    = !!game.heroImage;
        const hasHero      = hasDbHero || hasDiskHero;
        const hasDbLogo    = !!(game.logo || game.defaultLogo);
        const hasLogo      = hasDbLogo || hasDiskLogo;

        // ── RECOVERY: MRM says RESOLVED but game has no usable art ────────────
        // This happens when a prior pipeline run resolved metadata but the image
        // download or DB write then failed.  Without this reset the game is stuck
        // behind the 7-day RESOLVED lock even though its card is blank.
        const mrmStatus = mrm.getStatus(game.id);
        if (mrmStatus === MRM_STATUS.RESOLVED && !hasAnyArt) {
            console.log(`${gameTag} ⚠ MRM RESOLVED but no usable art in DB/cache — resetting to IDLE`);
            mrm.resetToIdle(game.id);
            await metadataCacheStore.deleteEntry(game.id).catch(() => {});
            recovered++;
        }

        // ── Skip only when cover + hero + logo are all present + metadata cached ─
        // Any missing visual asset must NOT trigger a skip — backfill runs instead.
        try {
            if (hasAnyArt && hasHero && hasLogo && await metadataCacheStore.hasEntry(game.id)) {
                console.log(`${gameTag} ↷ Has cached metadata + cover + hero + logo — skipping.`);
                skipped++;
                continue;
            }
        } catch { /* continue */ }

        // ── Hero backfill: cover/logo present but hero still missing ──────────
        // If cached metadata already has a hero URL we can download it directly
        // without triggering a full re-resolve.  If the cached metadata has no
        // hero URL the server had no hero data at that time — honour it and skip
        // until the 7-day metadata TTL expires and triggers a fresh resolve.
        if (hasAnyArt && !hasHero) {
            let heroHandled = false;
            try {
                const hasMeta = await metadataCacheStore.hasEntry(game.id);
                if (hasMeta) {
                    console.log(`${gameTag} [HeroBackfill] missing hero but cover/logo present — retrying`);
                    const cachedMeta   = await metadataCacheStore.load(game.id);
                    const cachedHeroUrl = cachedMeta?.heroImage || cachedMeta?.hero || null;
                    if (cachedHeroUrl) {
                        let finalHero = cachedHeroUrl;
                        if (_imageDownloadFn) {
                            try {
                                const dl = await _imageDownloadFn({ hero: cachedHeroUrl }, game.id);
                                if (dl?.hero) finalHero = dl.hero;
                                console.log(`${gameTag} [HeroBackfill] hero cached successfully (${finalHero})`);
                            } catch (e) {
                                console.warn(`${gameTag} [HeroBackfill] download failed, using remote URL:`, e.message);
                            }
                        }
                        try {
                            await engine.updateGameMetadata(game.id, { hero: finalHero }, { source: 'pipeline' });
                            engine.saveDatabase();
                            console.log(`${gameTag} [HeroBackfill] reused cached metadata hero — DB updated`);
                            if (_gameImageUpdatedFn) {
                                const updatedGame = engine.dbCache.find(g => g.id === game.id);
                                if (updatedGame) _gameImageUpdatedFn(updatedGame);
                            }
                        } catch (e) {
                            console.warn(`${gameTag} [HeroBackfill] DB update failed:`, e.message);
                        }
                        heroHandled = true;
                    } else {
                        // Cache entry exists but has no hero — treat as stale/incomplete.
                        // Delete it and reset MRM so the full pipeline re-resolves fresh data.
                        console.log(`${gameTag} [IncompleteArtRecovery] cache has no hero/logo -> force refresh`);
                        await metadataCacheStore.deleteEntry(game.id).catch(() => {});
                        mrm.resetToIdle(game.id);
                        // heroHandled stays false → falls through to full resolve below
                    }
                }
                // No metadata cache entry → fall through to full pipeline
            } catch (e) {
                console.warn(`${gameTag} [HeroBackfill] error:`, e.message);
            }
            if (heroHandled) {
                await new Promise(r => setTimeout(r, 300));
                continue;
            }
        }

        // ── Logo backfill: hero present but logo still missing ────────────────
        // Runs only when hero is already resolved so we avoid a full re-resolve
        // just for a logo.  Reads from the cached metadata without network traffic.
        if (hasAnyArt && hasHero && !hasLogo) {
            try {
                const hasMeta = await metadataCacheStore.hasEntry(game.id);
                if (hasMeta) {
                    const cachedMeta    = await metadataCacheStore.load(game.id);
                    const cachedLogoUrl = cachedMeta?.logo || cachedMeta?.defaultLogo || null;
                    if (cachedLogoUrl && _imageDownloadFn) {
                        const dl = await _imageDownloadFn({ logo: cachedLogoUrl }, game.id);
                        const finalLogo = dl?.logo || cachedLogoUrl;
                        await engine.updateGameMetadata(game.id, { logo: finalLogo }, { source: 'pipeline' });
                        engine.saveDatabase();
                        console.log(`${gameTag} [IncompleteArtRecovery] backfilled logo (${finalLogo})`);
                        if (_gameImageUpdatedFn) {
                            const upd = engine.dbCache.find(g => g.id === game.id);
                            if (upd) _gameImageUpdatedFn(upd);
                        }
                    }
                    await new Promise(r => setTimeout(r, 300));
                    continue;
                }
            } catch (e) {
                console.warn(`${gameTag} [IncompleteArtRecovery] logo backfill error:`, e.message);
            }
        }

        // ── Skip games only on active cooldown MRM state ──────────────────────
        const effectiveMrmStatus = mrm.getStatus(game.id); // re-read after potential reset
        if (effectiveMrmStatus === MRM_STATUS.COOLDOWN) {
            const job = mrm.getJob(game.id);
            console.log(`${gameTag} ↷ MRM cooldown until ${new Date(job?.cooldownUntil).toISOString()} — skipping.`);
            mrmSkipped++;
            continue;
        }

        // ── Route ALL resolution through MRM (Stage 1 DB + Stage 2 transient) ─
        // Use the centralized candidate generator so compact names like "ACMirage"
        // get camelCase-split + franchise-alias expansion.
        const candidates = generateMetadataCandidates({
            name:       game.name,
            folderName: game.folderName || game.path ? require('path').basename(require('path').dirname(game.path || game.command || '')) : undefined,
            exeName:    game.exeName,
            pathHint:   game.path || (game.command || '').replace(/^"|"$/g, '').trim() || undefined,
        });

        console.log(`${gameTag} MRM candidates: ${candidates.map(c => c.title || c.slug).join(', ')}`);

        // primary title = game.name (or first candidate's displayName)
        const primaryTitle = game.name || (candidates[0]?.title) || '';
        const { slug: _primarySlug } = (candidates[0] ? { slug: candidates[0].slug } : {});

        const resolveResult = await mrm.resolve(game.id, {
            candidates,
            title:        primaryTitle,
            slug:         _primarySlug || undefined,
            platformHint: _mapPlatformHint(game.platform) || undefined,
        });

        const meta = resolveResult ? Object.assign({}, resolveResult.meta, { _resolveSource: resolveResult._resolveSource }) : null;

        // ── STEP 4: Persist metadata + cache assets + backfill DB ────────────
        if (meta) {
            // Use normalizeAssets to canonicalise cover/hero/logo regardless of
            // which alias the normalise functions returned (heroImage vs hero).
            const { cover: remoteCover, hero: remoteHero, logo: remoteLogo } =
                baddelApi.normalizeAssets(meta);

            try {
                await metadataCacheStore.save(game.id, game.name, game.platform, meta);
                console.log(`${gameTag} ✓ Full metadata persisted to local cache`);
                resolved++;
            } catch (err) {
                console.warn(`${gameTag} Failed to persist metadata:`, err.message);
            }

            // ── Backfill cover/hero/logo into the game DB entry ──────────────
            let finalCover = remoteCover;
            let finalHero  = remoteHero;
            let finalLogo  = remoteLogo;

            if (_imageDownloadFn) {
                try {
                    const assets = { cover: remoteCover, hero: remoteHero, logo: remoteLogo };
                    const cached = await _imageDownloadFn(assets, game.id);
                    if (cached?.cover) finalCover = cached.cover;
                    if (cached?.hero)  finalHero  = cached.hero;
                    if (cached?.logo)  finalLogo  = cached.logo;
                    console.log(`${gameTag} ✓ Assets cached locally (cover=${!!finalCover} hero=${!!finalHero} logo=${!!finalLogo})`);
                } catch (err) {
                    console.warn(`${gameTag} Asset caching error (non-fatal) — using remote URLs:`, err.message);
                }
            }

            if (finalCover || finalHero || finalLogo) {
                try {
                    await engine.updateGameMetadata(game.id, {
                        cover: finalCover,
                        hero:  finalHero,
                        logo:  finalLogo,
                    }, { source: 'pipeline' });
                    engine.saveDatabase();
                    console.log(`${gameTag} ✓ DB entry backfilled (cover=${!!finalCover} hero=${!!finalHero} logo=${!!finalLogo})`);

                    if (_gameImageUpdatedFn) {
                        const updatedGame = engine.dbCache.find(g => g.id === game.id);
                        if (updatedGame) {
                            _gameImageUpdatedFn(updatedGame);
                            console.log(`${gameTag} ✓ Renderer notified (game-image-updated)`);
                        }
                    }
                } catch (err) {
                    console.warn(`${gameTag} DB backfill error:`, err.message);
                }
            } else {
                // Metadata resolved (text / ratings) but no images at all.
                // Reset MRM so the next pipeline pass retries image fetching;
                // this keeps exception_keep_pending_art games in the retry loop.
                mrm.resetToIdle(game.id);
                console.log(`${gameTag} ⚠ Resolved metadata has no images — MRM reset to IDLE for retry`);
            }
        } else {
            missed++;
            console.log(`${gameTag} ✗ No metadata found from any source`);
        }

        // Throttle: 300 ms between games to avoid hammering the server
        await new Promise(r => setTimeout(r, 300));
    }

    console.log(
        `${TAG} ══════ Pipeline END — resolved=${resolved} mrmSkipped=${mrmSkipped} ` +
        `cached=${skipped} missed=${missed} recovered=${recovered} ══════`
    );
}

/** Simple completeness check (mirrors _gdIsMetadataTooIncomplete in game-details.js) */
function _isMetaTooIncomplete(meta) {
    if (!meta) return true;
    const hasDescription = !!(meta.info?.description || meta.description);
    const hasCover       = !!(meta.cover);
    const hasHero        = !!(meta.heroImage || meta.hero);
    const hasScreenshots = (meta.info?.screenshots || []).length > 0;
    const missingVisuals = [hasCover, hasHero, hasScreenshots].filter(Boolean).length < 2;
    return !hasDescription && missingVisuals;
}

/** Image downloader injected from main.js (caches remote URLs to local disk as WebP). */
let _imageDownloadFn = null;
function registerImageDownloader(fn) {
    _imageDownloadFn = fn;
}

/**
 * Optional live-update notifier injected from main.js.
 * When registered, the background pipeline calls this after writing new
 * cover/hero/logo into the DB so the renderer can refresh the card immediately
 * without waiting for a full rescan.
 *
 * Expected signature: (game: object) => void
 * Typical implementation in main.js:
 *   registerGameImageUpdatedNotifier(game => mainWindow.webContents.send('game-image-updated', game));
 */
let _gameImageUpdatedFn = null;
function registerGameImageUpdatedNotifier(fn) {
    _gameImageUpdatedFn = fn;
    console.log('[BackgroundMetaPipeline] game-image-updated notifier registered.');
}

module.exports = {
    scanAllGames:          () => engine.startGlobalScan(),
    addManualGame:         (exePath, customName, cb) => engine.addManualGame(exePath, customName, cb),
    getSavedGames:         () => engine.getStoredGames(),
    getMissingInstalledGames: () => engine.getMissingInstalledGames(),
    renameGame:            (id, name) => engine.renameGame(id, name),
    removeGame:            (id) => engine.removeGame(id),
    unhideAllGames:        () => engine.unhideAllGames(),
    getHiddenGames:        () => engine.getHiddenGames(),
    restoreSpecificGames:  (ids) => engine.restoreSpecificGames(ids),
    deleteGamePermanently: (id) => engine.deleteGamePermanently(id),
    updateGameImage:       (id, imgPath, type) => engine.updateGameImage(id, imgPath, type),
    resetGameImage:        (id, type) => engine.resetGameImage(id, type),
    updateGameMetadata:    (id, meta, opts) => engine.updateGameMetadata(id, meta, opts),
    reorderLibrary:        (ids) => engine.reorderLibrary(ids),
    updatePlaytime:        (id, minutes) => engine.updatePlaytime(id, minutes),
    saveQualifiedSession:  (id, sessionData) => engine.saveQualifiedSession(id, sessionData),
    setTimeTrackingEnabled: (id, enabled) => engine.setTimeTrackingEnabled(id, enabled),
    getTimeTrackingEnabled: (id)          => engine.getTimeTrackingEnabled(id),
    refetchMissingImages:  (cb) => refetchMissingImages(cb),
    getLocalSteamGames:    () => engine.getLocalSteamGames(),
    saveFullMetadata: (gameId, title, platform, meta) => metadataCacheStore.save(gameId, title, platform, meta),
    loadFullMetadata: (gameId)                         => metadataCacheStore.load(gameId),

    // ── Background pipeline ──────────────────────────────────────────────────
    runBackgroundMetadataPipeline,
    registerLocalMetadataResolver,
    registerImageDownloader,
    registerGameImageUpdatedNotifier,

    // ── Epic cleanup ─────────────────────────────────────────────────────────
    removeEpicNonGameEntries: (entries) => engine.removeEpicNonGameEntries(entries),

    // ── Unified resolution manager ───────────────────────────────────────────
    resolutionManager: mrm,
    BaddelEngine,
    __scannerTest: {
        normalizePath,
        pathExists,
        fileExists,
        dirExists,
        dirHasUsefulFiles,
        findFirstExisting,
        findLikelyGameExe,
        isLauncherOrHelperExe,
        makeInstalledGameKey,
        isGameInstallValid,
        withTimeout,
        safeJsonParse,
        normalizeDisplayName,
        normalizeScannerPlatform,
    },
};