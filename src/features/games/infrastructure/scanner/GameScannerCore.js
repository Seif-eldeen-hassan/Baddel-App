'use strict';

// ─── GameScannerCore ──────────────────────────────────────────────────────────
//
// Owns all filesystem-scanning responsibilities that were previously embedded
// directly in BaddelEngine (gameScanner.js).
//
// Responsibilities:
//   • Filesystem utility helpers (pathExists, fileExists, dirExists, etc.)
//   • Platform-specific manifest / registry readers (Steam, Epic, Riot, Ubisoft, EA, Xbox)
//   • Raw game-object builders (_buildSteamGameFromManifest, etc.)
//   • Per-platform scan methods (getSteamGames, getEpicGames, etc.)
//   • getOfficialGames — orchestrates all platform scanners
//
// What this module does NOT do:
//   • Persist any data (no games-db.json writes)
//   • Merge/deduplicate across platforms (that stays in BaddelEngine.startGlobalScan)
//   • Metadata enrichment / image caching (that stays in GameMetadataPipeline)
//
// Runtime behaviour is IDENTICAL to the original BaddelEngine scan methods.
// Only the module boundary changed — no logic was modified.
//
// ─────────────────────────────────────────────────────────────────────────────

const fs        = require('fs').promises;
const fsSync    = require('fs');
const path      = require('path');
const os        = require('os');
const { exec }  = require('child_process');
const util      = require('util');
const execAsync = util.promisify(exec);
const crypto    = require('crypto');

// ─── Shortcut args parser ─────────────────────────────────────────────────────
function parseShortcutArgs(rawArgs) {
    if (!rawArgs || typeof rawArgs !== 'string') return [];
    const args = [];
    const re = /"([^"\\]*(?:\\.[^"\\]*)*)"|(\S+)/g;
    let m;
    while ((m = re.exec(rawArgs.trim())) !== null) {
        args.push(m[1] !== undefined ? m[1] : m[2]);
    }
    return args;
}

// ─── Cache file stem helper ───────────────────────────────────────────────────
function _cacheBaseName(type, gameId) {
    return `${type}_${String(gameId)}`;
}

// ─── Platform hint mapper ─────────────────────────────────────────────────────
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
    return null;
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
    const maxDepth   = Number.isFinite(options.maxDepth)   ? options.maxDepth   : 2;
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

    const maxDepth   = Number.isFinite(options.maxDepth)   ? options.maxDepth   : 5;
    const maxEntries = Number.isFinite(options.maxEntries) ? options.maxEntries : 1500;
    const excludeDirs = new Set([...(options.excludeDirs || []), '_commonredist', 'redist', 'redistributable', 'directx', 'support', 'easyanticheat', 'battleye'].map(s => String(s).toLowerCase()));
    let visited  = 0;
    let best     = null;
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
        const ns       = game.catalogNamespace || game.namespace || ids.epic || '';
        const item     = game.catalogItemId || game.catalogItemID || game.catalogId || '';
        const appName  = game.appName || game.app_name || '';
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
// GameScannerCore
// ============================================================
class GameScannerCore {
    /**
     * @param {{
     *   programData:    string,
     *   dbFolder:       string,
     *   testDriveRoots: string[]|null,
     *   riotSearchRoots: string[]|null,
     *   api:            object,   — baddelApi instance
     *   mrm:            object,   — MetadataResolutionManager instance
     *   MRM_STATUS:     object,   — MRM_STATUS enum
     * }} opts
     */
    constructor({ programData, dbFolder, testDriveRoots, riotSearchRoots, api, mrm, MRM_STATUS }) {
        this.programData      = programData;
        this.dbFolder         = dbFolder;
        this._testDriveRoots  = testDriveRoots  || null;
        this._riotSearchRoots = riotSearchRoots || null;
        this._api             = api;
        this._mrm             = mrm;
        this._MRM_STATUS      = MRM_STATUS;
        this._scanReports     = {};
    }

    // ============================================================
    // SCAN REPORT TRACKING
    // ============================================================
    _platformReport(platform) {
        const key = normalizeScannerPlatform(platform);
        if (!this._scanReports[key]) {
            this._scanReports[key] = {
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
        return this._scanReports[key];
    }

    _recordRaw(platform, count = 1) {
        this._platformReport(platform).raw += count;
    }

    _recordValid(platform, count = 1) {
        const report = this._platformReport(platform);
        report.valid += count;
        report.kept  += count;
    }

    _recordSkip(platform, reason, candidate = {}) {
        const report = this._platformReport(platform);
        report.skipped++;
        if (reason === 'install_path_missing')                                        report.skippedMissingPath++;
        else if (reason === 'exe_missing')                                            report.skippedMissingExe++;
        else if (reason === 'stale_registry_entry' || reason === 'install_path_empty') report.skippedStale++;
        if (platform === 'ubisoft') {
            console.log(`[Ubisoft Scan] SKIP stale registry entry "${candidate.name || candidate.Name || candidate.DisplayName || 'Unknown'}" ${reason} path=${candidate.path || candidate.Path || candidate.InstallDir || candidate.InstallLocation || ''}`);
        }
    }

    _recordError(platform, err) {
        this._platformReport(platform).errors.push(err?.message || String(err));
    }

    clearScanReports() {
        this._scanReports = {};
    }

    getScanReports() {
        return this._scanReports;
    }

    // ============================================================
    // PREFER LOGIC
    // ============================================================
    _preferDetectedCandidate(existing, candidate) {
        if (!existing) return candidate;
        const existingHasExe  = !!existing.executablePath;
        const candidateHasExe = !!candidate.executablePath;
        if (candidateHasExe && !existingHasExe) return candidate;
        if (candidateHasExe === existingHasExe) {
            const existingPath  = normalizePath(existing.path  || '');
            const candidatePath = normalizePath(candidate.path || '');
            if (candidatePath && (!existingPath || candidatePath.length < existingPath.length)) return candidate;
        }
        return existing;
    }

    // ============================================================
    // FILESYSTEM HELPERS
    // ============================================================
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

    // ============================================================
    // STEAM HELPERS
    // ============================================================
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
        const name       = normalizeDisplayName(this._parseVdfValue(acf, 'name'));
        const appid      = this._parseVdfValue(acf, 'appid');
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

    // ============================================================
    // EPIC HELPERS
    // ============================================================
    _resolveEpicLaunchExecutable(installLocation, launchExecutable) {
        if (!launchExecutable) return null;
        const raw     = String(launchExecutable).trim().replace(/^"+|"+$/g, '');
        const exePart = raw.match(/^(.*?\.exe)\b/i)?.[1] || raw;
        const clean   = _cleanPathInput(exePart);
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

        const { classifyEpicEntry } = require('../../../../../platformSyncShared');
        const classifierEntry = {
            app_name:         AppName,
            app_title:        name,
            title:            name,
            namespace:        CatalogNamespace,
            catalogNamespace: CatalogNamespace,
            catalogItemId:    CatalogItemId,
            executable:       LaunchExecutable || null,
            metadata:         data,
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

        const likelyExe      = launchExe || findLikelyGameExe(InstallLocation, { nameHint: name, maxDepth: 5 });
        const launcherGameId = `${CatalogNamespace}:${CatalogItemId}:${AppName}`;
        const safeId         = launcherGameId.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '');
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

    async _getLegendaryMetadata(appName) {
        try {
            const userData = this.dbFolder;
            const dirs     = await fs.readdir(userData);
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
            const img = keyImages.find(k => k.type === type);
            if (img?.url) return img.url;
        }
        return null;
    }

    _pickEpicLogo(keyImages) {
        if (!Array.isArray(keyImages) || keyImages.length === 0) return null;
        const PREF = ['DieselLogo', 'Logo', 'OfferLogo'];
        for (const type of PREF) {
            const img = keyImages.find(k => k.type === type);
            if (img?.url) return img.url;
        }
        return null;
    }

    // ============================================================
    // UBISOFT HELPERS
    // ============================================================
    _buildUbisoftGameFromCandidate(candidate = {}) {
        this._recordRaw('ubisoft');
        const appId      = candidate.Id || candidate.id || candidate.AppId || candidate.GameId || null;
        const name       = normalizeDisplayName(candidate.Name || candidate.DisplayName || candidate.Title);
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

    // ============================================================
    // EA HELPERS
    // ============================================================
    _buildEAGameFromCandidate(candidate = {}) {
        this._recordRaw('ea');
        const name       = normalizeDisplayName(candidate.Name || candidate.DisplayName || candidate.Title);
        const installDir = _cleanPathInput(candidate.Path || candidate.InstallDir || candidate.InstallLocation);
        const appId      = candidate.Id || candidate.AppId || candidate.ProductId || null;
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
        const eaLaunchCmd = (candidate.LaunchCommand && !/mobilehome/i.test(candidate.LaunchCommand))
            ? candidate.LaunchCommand
            : exe;
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
            command: eaLaunchCmd,
            launchCommand: eaLaunchCmd,
            launchCwd: path.dirname(exe),
            score: 100,
            allIds: appId ? { ea: String(appId) } : {},
            scanSourceDetail: candidate.scanSourceDetail || 'ea_uninstall_registry',
        };
        game.installedGameKey = makeInstalledGameKey(game);
        this._recordValid('ea');
        return game;
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
        return results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
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
                        const acf  = await fs.readFile(path.join(appsPath, file), 'utf8');
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
            const fsPromises = require('fs').promises;
            const content = await fsPromises.readFile(vdfPath, 'utf8');
            const matches = content.match(/"path"\s+"([^"]+)"/g);
            const libraries = [...new Set(
                matches ? matches.map(m => m.match(/"path"\s+"([^"]+)"/)[1].replace(/\\\\/g, '\\')) : [steamPath]
            )];

            for (const lib of libraries) {
                const appsPath = path.join(lib, 'steamapps');
                try {
                    const files = await fsPromises.readdir(appsPath);
                    for (const file of files) {
                        if (!file.startsWith('appmanifest_') || !file.endsWith('.acf')) continue;
                        const acf   = await fsPromises.readFile(path.join(appsPath, file), 'utf8');
                        const name  = acf.match(/"name"\s+"([^"]+)"/i)?.[1];
                        const appid = acf.match(/"appid"\s+"(\d+)"/i)?.[1];
                        if (name && appid && !name.includes('Steamworks')) {
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
                const raw  = await fs.readFile(path.join(root, file), 'utf8');
                const data = safeJsonParse(raw, null);
                if (!data) {
                    this._recordSkip('epic', 'invalid_manifest', { name: file });
                    continue;
                }

                const game = this._buildEpicGameFromManifest(data, path.join(root, file));
                if (game) {
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

    // --- Riot Games ---
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

            const normalized = clean.replace(/[\\/]+/g, '\\');
            const lower      = normalized.toLowerCase();
            const product    = String(productDir || '').toLowerCase();

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
            const raw  = await fs.readFile(path.join(this.programData, 'Riot Games', 'RiotClientInstalls.json'), 'utf8');
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
            const liveDir    = path.join(productDir, 'live');
            this._recordRaw('riot');
            if (!dirExists(productDir) || !dirExists(liveDir)) {
                this._recordSkip('riot', 'install_path_missing', { name: 'VALORANT', path: productDir });
                return null;
            }
            const directExe  = path.join(liveDir, 'VALORANT.exe');
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
            const client       = findRiotClient(root);
            const fallbackLaunch = fileExists(directExe) ? directExe : realExe;
            const command = client
                ? `"${client}" --launch-product=valorant --launch-patchline=live`
                : `"${fallbackLaunch}"`;
            const exeCandidates = [...new Set([
                path.basename(realExe),
                fileExists(shippingExe) ? path.basename(shippingExe) : null,
                fileExists(directExe)  ? path.basename(directExe)  : null,
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
            const gameExe      = path.join(productDir, 'Game', 'League of Legends.exe');
            const realExe      = findFirstExisting([leagueClient, gameExe]);
            if (!realExe || !fileExists(realExe)) {
                this._recordSkip('riot', 'exe_missing', { name: 'League of Legends', path: productDir });
                return null;
            }
            const client       = findRiotClient(root);
            const fallbackLaunch = fileExists(leagueClient) ? leagueClient : realExe;
            const command = client
                ? `"${client}" --launch-product=league_of_legends --launch-patchline=live`
                : `"${fallbackLaunch}"`;
            const leagueUx = path.join(productDir, 'LeagueClientUx.exe');
            const exeCandidates = [...new Set([
                fileExists(leagueClient) ? 'LeagueClient.exe' : null,
                fileExists(leagueUx)     ? 'LeagueClientUx.exe' : null,
                fileExists(gameExe)      ? 'League of Legends.exe' : null,
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

        const BLOAT = new Set([
            'bingnews', 'bingweather', 'xbox', 'xboxgamingoverlay',
            'xboxidentityprovider', 'xboxspeechtotext', 'microsoft.549981c3f5f10', 'microsoft.3dbuilder',
            'microsoft.windowsalarms', 'microsoftteams', 'microsoft.windowscommunicationsapps',
            'windowsmaps', 'messaging', 'windowscamera', 'zune', 'wallet', 'windowsfeedback',
            'getstarted', 'officehub', 'onenote', 'skype', 'windowsphone',
            'print3d', 'screensketch', 'yourconsole', 'xboxapp', 'mixedreality', 'holographic'
        ]);

        const EXCEPTIONS = new Set([
            'minecraft', 'forza', 'halo', 'gears', 'sea of thieves', 'grounded',
            'microsoft jigsaw', 'microsoft solitaire', 'solitaire collection',
        ]);

        const JUNK_TERMS = [
            'extension', 'runtime', 'installer', 'terminal', 'calculator',
            'sound recorder', 'media extensions', 'video extension', 'image extension',
            'quick assist', 'dev home', 'app runtime', 'purchase app', 'speech',
            'get help', 'your phone', 'gaming app',
            'whiteboard', 'sticky notes', 'notes', 'notepad', 'paint', 'photos',
            'clipchamp', 'outlook', 'onedrive', 'onenote', 'copilot', 'family',
            'linkedin', 'whatsapp', 'instagram', 'facebook',
            'visual studio code', 'edge', ' ui ',
            'store', 'widget', 'health',
            'chatgpt', 'chat gpt', 'open ai', 'openai', 'claude',
            'power automate', 'automate desktop', 'source',
            'control panel', 'nvidia control panel',
            'malwarebytes',
            'adobe acrobat',
            'translucent tb', 'charles milette',
        ];

        const _normalizeForFilter = (displayName) =>
            ' ' + displayName.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim() + ' ';

        const isLikelyXboxGameCandidate = (displayName) => {
            const norm = _normalizeForFilter(displayName);
            if ([...EXCEPTIONS].some(e => norm.includes(' ' + e + ' ') || norm.trim().includes(e))) return true;
            return ![...JUNK_TERMS].some(t => norm.includes(t));
        };

        const _toSlug = (name) =>
            name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

        const _hasImageAsset = (meta) => {
            if (!meta) return false;
            return !!(meta.cover || meta.heroImage || meta.logo || meta.image || meta.hero);
        };

        const _isPlausibleGameTitle = (displayName) => {
            const norm = displayName.trim();
            if (/^\d/.test(norm)) return false;
            if (/\bv?\d+\.\d+/.test(norm)) return false;
            const tokens = norm.split(/\s+/);
            const longUpperTokens = tokens.filter(t => t.length >= 5 && t === t.toUpperCase() && /^[A-Z]+$/.test(t));
            if (longUpperTokens.length > 0) return false;
            const UTILITY_TERMS = [
                'desktop', 'helper', 'assistant', 'driver', 'plugin', 'addin',
                'redistributable', 'framework', 'package', 'update', 'patch',
            ];
            const lower = ' ' + norm.toLowerCase() + ' ';
            if (UTILITY_TERMS.some(t => lower.includes(` ${t} `) || lower.includes(` ${t}s `))) return false;
            if (norm.length < 2 || norm.length > 60) return false;
            return true;
        };

        try {
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
                    throw err;
                }
            }

            console.log(`[Xbox Scan] mode=${scanMode}`);

            if (!stdout?.trim()) return [];
            let apps = JSON.parse(stdout);
            if (!Array.isArray(apps)) apps = [apps];

            const totalRaw    = apps.length;
            const xboxReport  = this._platformReport('xbox');
            xboxReport.raw    = totalRaw;

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

            const allCandidates = afterPathValidation.map(app => {
                const appUserModelId   = `${app.PackageFamilyName}!App`;
                const appsFolderTarget = `shell:AppsFolder\\${appUserModelId}`;
                return {
                    name: app.Name
                        .replace(/Microsoft\./i, '')
                        .replace(/\./g, ' ')
                        .replace(/([a-z])([A-Z])/g, '$1 $2')
                        .trim(),
                    packageFamilyName: app.PackageFamilyName,
                    appUserModelId,
                    launchType:      'uwp-appsfolder',
                    platform:        'Xbox / Store',
                    scannerPlatform: 'xbox',
                    installSource:   'scanner',
                    launcherGameId:  app.PackageFamilyName,
                    path:            app.InstallLocation,
                    command:         appsFolderTarget,
                    launchCommand:   appsFolderTarget,
                    installVerified: true,
                    isInstalled:     true,
                    allIds:          { xbox: app.PackageFamilyName },
                    scanSourceDetail: `appx-${scanMode}`,
                    score: 90,
                };
            });
            allCandidates.forEach(c => {
                c.id = `xbox-${String(c.packageFamilyName || c.name).replace(/[^a-z0-9_-]+/gi, '-')}`;
                c.installedGameKey = makeInstalledGameKey(c);
            });

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

            candidates.sort((a, b) => {
                const aEx = [...EXCEPTIONS].some(e => a.name.toLowerCase().includes(e));
                const bEx = [...EXCEPTIONS].some(e => b.name.toLowerCase().includes(e));
                return (bEx ? 1 : 0) - (aEx ? 1 : 0);
            });

            const TRANSIENT_BUDGET = 5;
            let   transientUsed    = 0;

            let rateLimitedUntil = 0;
            let rateLimitedAt    = null;

            const validationCache    = new Map();
            const deferredCandidates = [];

            let totalKept     = 0;
            let totalDropped  = 0;
            let totalDeferred = 0;

            const CONCURRENCY = 3;
            let index = 0;

            const worker = async () => {
                while (index < candidates.length) {
                    const candidate = candidates[index++];
                    const nameLower = candidate.name.toLowerCase();
                    const cacheKey  = nameLower;

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

                    const isException = [...EXCEPTIONS].some(e => nameLower.includes(e));
                    if (isException) {
                        console.log(`[Xbox Scan] EXCEPTION KEEP     "${candidate.name}" — attempting art hydration`);
                    }

                    const mrmKey = `xbox_candidate:${_toSlug(candidate.name) || candidate.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
                    let meta = null;
                    let stage1Error = false;

                    try {
                        const slug = _toSlug(candidate.name);
                        const slugResult = await this._api.lookupGame({ slug });
                        if (slugResult) {
                            const normalised = this._api.normalizeServerData(slugResult);
                            if (_hasImageAsset(normalised)) {
                                meta = normalised;
                                console.log(`[Xbox Scan] KEEP server-hit    "${candidate.name}" (slug)`);
                            }
                        }

                        if (!meta) {
                            const titleResult = await this._api.lookupGame({ title: candidate.name });
                            if (titleResult) {
                                const normalised = this._api.normalizeServerData(titleResult);
                                if (_hasImageAsset(normalised)) {
                                    meta = normalised;
                                    console.log(`[Xbox Scan] KEEP server-hit    "${candidate.name}" (title)`);
                                }
                            }
                        }
                    } catch (lookupErr) {
                        console.warn(`[Xbox Scan] lookup error "${candidate.name}":`, lookupErr.message);
                        stage1Error = true;
                    }

                    if (meta) {
                        _hydrate(candidate, meta);
                        validationCache.set(cacheKey, { action: 'keep', meta });
                        games.push(candidate);
                        totalKept++;
                        this._mrm.markResolved(mrmKey, { matchedName: candidate.name, resolveSource: 'server-hit' });
                        continue;
                    }

                    if (stage1Error) {
                        if (isException) {
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

                    const now = Date.now();
                    const isRateLimited = rateLimitedUntil > now;

                    if (isRateLimited) {
                        if (isException) {
                            console.log(`[Xbox Scan] EXCEPTION KEEP (no-art) "${candidate.name}" (rate-limit active — art deferred)`);
                            _markDeferred(candidate, 'exception_keep_pending_art');
                            validationCache.set(cacheKey, { action: 'keep', meta: null });
                            games.push(candidate);
                            totalKept++;
                        } else {
                            console.log(`[Xbox Scan] DEFERRED hidden-from-library "${candidate.name}" (rate-limit active)`);
                            _markDeferred(candidate, 'rate_limited');
                            validationCache.set(cacheKey, { action: 'defer', reason: 'rate_limited' });
                            deferredCandidates.push(candidate);
                            totalDeferred++;
                        }
                        continue;
                    }

                    if (!_isPlausibleGameTitle(candidate.name)) {
                        console.log(`[Xbox Scan] DROP implausible-title "${candidate.name}"`);
                        validationCache.set(cacheKey, { action: 'drop' });
                        totalDropped++;
                        continue;
                    }

                    if (this._mrm.getStatus(mrmKey) === this._MRM_STATUS.COOLDOWN) {
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

                    if (transientUsed >= TRANSIENT_BUDGET && !isException) {
                        console.log(`[Xbox Scan] DEFERRED (transient budget exhausted) "${candidate.name}"`);
                        _markDeferred(candidate, 'budget_exhausted');
                        validationCache.set(cacheKey, { action: 'defer', reason: 'budget_exhausted' });
                        deferredCandidates.push(candidate);
                        totalDeferred++;
                        continue;
                    }
                    transientUsed++;

                    let resolveOutcome = 'pending';

                    const mrmResult = await this._mrm.resolve(mrmKey, {
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
                        const postStatus = this._mrm.getStatus(mrmKey);
                        if (postStatus === this._MRM_STATUS.COOLDOWN) {
                            const job = this._mrm.getJob(mrmKey);
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
                        } else if (postStatus === this._MRM_STATUS.NOT_FOUND) {
                            resolveOutcome = 'not_found';
                        } else if (postStatus === this._MRM_STATUS.AMBIGUOUS) {
                            resolveOutcome = 'ambiguous';
                        } else {
                            resolveOutcome = 'network_error';
                        }
                    }

                    if (resolveOutcome === 'resolved' && meta) {
                        _hydrate(candidate, meta);
                        validationCache.set(cacheKey, { action: 'keep', meta });
                        games.push(candidate);
                        totalKept++;
                        console.log(`[Xbox Scan] KEEP transient-resolved "${candidate.name}" (cover=${!!candidate.image} hero=${!!candidate.heroImage} logo=${!!candidate.logo})`);

                    } else if (resolveOutcome === 'not_found' && !isException) {
                        validationCache.set(cacheKey, { action: 'drop' });
                        totalDropped++;
                        console.log(`[Xbox Scan] DROP confirmed-not-found "${candidate.name}"`);

                    } else if (isException) {
                        _markDeferred(candidate, 'exception_keep_pending_art');
                        validationCache.set(cacheKey, { action: 'keep', meta: null });
                        games.push(candidate);
                        totalKept++;
                        console.log(`[Xbox Scan] EXCEPTION KEEP (no-art) "${candidate.name}" (reason=${resolveOutcome} — art deferred to background pipeline)`);

                    } else {
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
            xboxReport.valid    = totalKept;
            xboxReport.kept     = totalKept;
            xboxReport.skipped  = totalDropped + totalDeferred + totalPathDropped + totalPrefilterDropped;
            xboxReport.skippedMissingPath = totalPathDropped;

        } catch (err) {
            this._recordError('xbox', err);
            console.error('[Xbox Scan]', err);
        }
        return games;

        function _hydrate(candidate, meta) {
            if (meta.cover     || meta.image)    candidate.image     = meta.cover     || meta.image     || null;
            if (meta.heroImage || meta.hero)      candidate.heroImage = meta.heroImage || meta.hero      || null;
            if (meta.logo)                        candidate.logo      = meta.logo;
        }

        function _markDeferred(candidate, reason) {
            candidate.needsValidation    = true;
            candidate.validationDeferred = true;
            candidate.validationReason   = reason || 'unknown';
        }
    }
}

// ============================================================
// EXPORTS
// ============================================================
module.exports = {
    GameScannerCore,

    // Utility functions re-exported so gameScanner.js can use them without
    // duplicating definitions, and the __scannerTest surface stays intact.
    parseShortcutArgs,
    _cacheBaseName,
    _mapPlatformHint,
    SCANNER_PLATFORMS,
    PLATFORM_LABEL_TO_KEY,
    _cleanPathInput,
    normalizePath,
    pathExists,
    fileExists,
    dirExists,
    isLauncherOrHelperExe,
    dirHasUsefulFiles,
    findFirstExisting,
    findLikelyGameExe,
    safeJsonParse,
    normalizeDisplayName,
    normalizeScannerPlatform,
    makeInstalledGameKey,
    isGameInstallValid,
    withTimeout,
    _hashShort,
};
