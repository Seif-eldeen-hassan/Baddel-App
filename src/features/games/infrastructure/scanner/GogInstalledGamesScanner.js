'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const MANIFEST_RE = /^goggame-.*\.info$/i;
const NUMERIC_ID_RE = /^\d+$/;
const ROOT_CACHE_VERSION = 1;
const PROVENANCE_RANK = Object.freeze({ gog_discovered: 1, gog_galaxy: 2, gogdl: 3 });

const DEFAULT_LIMITS = Object.freeze({
    maxDepth: 3,
    maxEntries: 5000,
    maxManifestBytes: 1024 * 1024,
    timeoutMs: 15000,
    concurrency: 6,
    maxRoots: 128,
});

function cleanString(value) {
    return value == null ? '' : String(value).trim();
}

function numericId(value) {
    const result = cleanString(value);
    return NUMERIC_ID_RE.test(result) ? result : null;
}

function cleanRegistryPath(value) {
    let result = cleanString(value);
    if (!result) return '';
    result = result.replace(/^\s*"([^"]+)".*$/, '$1');
    result = result.replace(/,\s*-?\d+\s*$/, '');
    result = result.replace(/^\s*([^"].*?\.exe)(?:\s+.*)?$/i, '$1');
    return result.trim().replace(/^"|"$/g, '');
}

function canonicalPath(pathApi, value) {
    const input = cleanRegistryPath(value);
    if (!input || /^(?:\\\\|\\\?\\|\\\.\\)/.test(input)) return null;
    try {
        if (!pathApi.isAbsolute(input)) return null;
        const resolved = pathApi.resolve(input);
        const root = pathApi.parse(resolved).root;
        if (!root || resolved === root) return null;
        return resolved;
    } catch {
        return null;
    }
}

function pathKey(pathApi, value) {
    const canonical = canonicalPath(pathApi, value);
    return canonical ? canonical.replace(/[\\/]+$/g, '').toLowerCase() : '';
}

function isInside(pathApi, root, target) {
    try {
        const relative = pathApi.relative(pathApi.resolve(root), pathApi.resolve(target));
        return relative === '' || (!relative.startsWith('..' + pathApi.sep) && relative !== '..' && !pathApi.isAbsolute(relative));
    } catch {
        return false;
    }
}

function quoteExecutable(executablePath) {
    return `"${String(executablePath).replace(/"/g, '')}"`;
}

function parseWindowsArgs(raw) {
    if (Array.isArray(raw)) return raw.map(cleanString).filter(Boolean);
    const text = cleanString(raw);
    if (!text) return [];
    const result = [];
    const matcher = /"([^"\\]*(?:\\.[^"\\]*)*)"|(\S+)/g;
    let match;
    while ((match = matcher.exec(text))) result.push(match[1] === undefined ? match[2] : match[1]);
    return result.slice(0, 64).filter(arg => arg.length <= 4096);
}

function isUnsafeExecutableName(value) {
    const name = path.basename(cleanString(value)).toLowerCase();
    return !name.endsWith('.exe') || [
        /^unins\d*\.exe$/, /uninstall/, /setup/, /installer/, /installhelper/,
        /redistribut/, /vcredist/, /dxsetup/, /directx/, /support/, /crash/,
        /reporter/, /repair/, /updater?\.exe$/, /galaxyclient/, /galaxycommunication/,
        /goggalaxy/, /overlay/, /webhelper/, /prereq/, /dependency/,
    ].some(re => re.test(name));
}

function sourceState(status, extra = {}) {
    return { status, candidates: 0, accepted: 0, rejected: 0, reasonCodes: {}, ...extra };
}

function addReason(state, reason) {
    state.rejected += 1;
    state.reasonCodes[reason] = (state.reasonCodes[reason] || 0) + 1;
}

class WindowsGogRegistryAdapter {
    async listEntries() {
        if (process.platform !== 'win32') return { status: 'unavailable', entries: [] };
        const script = [
            "$ErrorActionPreference='Stop'",
            "$items=@()",
            "$views=@([Microsoft.Win32.RegistryView]::Registry64,[Microsoft.Win32.RegistryView]::Registry32)",
            "$hives=@([Microsoft.Win32.RegistryHive]::LocalMachine,[Microsoft.Win32.RegistryHive]::CurrentUser)",
            "foreach($h in $hives){foreach($v in $views){$base=$null;$key=$null;try{$base=[Microsoft.Win32.RegistryKey]::OpenBaseKey($h,$v);$key=$base.OpenSubKey('SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall');if($key){foreach($n in $key.GetSubKeyNames()){$sub=$null;try{$sub=$key.OpenSubKey($n);$items += [pscustomobject]@{Hive=$h.ToString();View=$v.ToString();KeyName=$n;DisplayName=$sub.GetValue('DisplayName');InstallLocation=$sub.GetValue('InstallLocation');DisplayIcon=$sub.GetValue('DisplayIcon');Publisher=$sub.GetValue('Publisher');UninstallString=$sub.GetValue('UninstallString')}}finally{if($sub){$sub.Dispose()}}}}}finally{if($key){$key.Dispose()};if($base){$base.Dispose()}}}}",
            "$items|ConvertTo-Json -Compress -Depth 3",
        ].join(';');
        try {
            const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
                windowsHide: true,
                timeout: 10000,
                maxBuffer: 4 * 1024 * 1024,
            });
            const parsed = stdout.trim() ? JSON.parse(stdout) : [];
            return { status: 'ready', entries: Array.isArray(parsed) ? parsed : [parsed] };
        } catch (error) {
            return { status: 'failed', entries: [], error: error?.code || error?.message || 'REGISTRY_QUERY_FAILED' };
        }
    }
}

class GalaxySqliteAdapter {
    constructor({ databasePath, userDataDir, fsApi = fs, pathApi = path, initSqlJs = null } = {}) {
        this.databasePath = databasePath;
        this.userDataDir = userDataDir;
        this.fs = fsApi;
        this.path = pathApi;
        this.initSqlJs = initSqlJs;
    }

    async readInstalledGames() {
        if (!this.databasePath || !this.fs.existsSync(this.databasePath)) return { status: 'unavailable', rows: [] };
        let tempDir = null;
        let db = null;
        let walUnapplied = false;
        try {
            tempDir = await this.fs.promises.mkdtemp(this.path.join(this.userDataDir || os.tmpdir(), 'gog-db-snapshot-'));
            const snapshot = this.path.join(tempDir, 'galaxy-2.0.db');
            await this.fs.promises.copyFile(this.databasePath, snapshot);
            for (const suffix of ['-wal', '-shm']) {
                try {
                    await this.fs.promises.copyFile(this.databasePath + suffix, snapshot + suffix);
                    if (suffix === '-wal' && (await this.fs.promises.stat(snapshot + suffix)).size > 32) walUnapplied = true;
                } catch { /* optional sidecar */ }
            }
            const loader = this.initSqlJs || require('sql.js');
            const SQL = await loader({
                locateFile: file => require.resolve(`sql.js/dist/${file}`),
            });
            db = new SQL.Database(await this.fs.promises.readFile(snapshot));
            const tablesResult = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
            const tables = new Set((tablesResult[0]?.values || []).map(row => String(row[0])));
            if (!tables.has('InstalledBaseProducts')) {
                return { status: 'failed', rows: [], error: 'GOG_DB_SCHEMA_UNSUPPORTED' };
            }
            const columnsResult = db.exec("PRAGMA table_info('InstalledBaseProducts')");
            const columns = new Set((columnsResult[0]?.values || []).map(row => String(row[1])));
            if (!columns.has('productId') || !columns.has('installationPath')) {
                return { status: 'failed', rows: [], error: 'GOG_DB_SCHEMA_UNSUPPORTED' };
            }
            let titleExpression = 'NULL';
            let join = '';
            if (tables.has('Products')) {
                const productColumnsResult = db.exec("PRAGMA table_info('Products')");
                const productColumns = new Set((productColumnsResult[0]?.values || []).map(row => String(row[1])));
                if (productColumns.has('id') && productColumns.has('name')) {
                    titleExpression = 'p.name';
                    join = ' LEFT JOIN Products p ON p.id = i.productId';
                }
            }
            const result = db.exec(`SELECT i.productId, i.installationPath, ${columns.has('buildId') ? 'i.buildId' : 'NULL'}, ${titleExpression} FROM InstalledBaseProducts i${join}`);
            return {
                // sql.js is deliberately used instead of a native Electron addon.
                // It cannot replay a live WAL sidecar, so rows from the immutable
                // main-file snapshot remain useful but cannot authorize deletion.
                status: walUnapplied ? 'partial' : 'ready',
                error: walUnapplied ? 'GOG_DB_WAL_UNAPPLIED' : null,
                rows: (result[0]?.values || []).map(row => ({
                    productId: cleanString(row[0]),
                    installationPath: cleanString(row[1]),
                    buildId: row[2] == null ? null : cleanString(row[2]),
                    title: row[3] == null ? null : cleanString(row[3]),
                })),
            };
        } catch (error) {
            return { status: 'failed', rows: [], error: /malformed|not a database|corrupt/i.test(error?.message || '') ? 'GOG_DB_CORRUPT' : 'GOG_DB_READ_FAILED' };
        } finally {
            try { db?.close(); } catch { /* no-op */ }
            if (tempDir) await this.fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
        }
    }
}

class GogInstalledGamesScanner {
    constructor(options = {}) {
        this.fs = options.fs || fs;
        this.path = options.path || path;
        this.programData = options.programData || process.env.ProgramData || 'C:\\ProgramData';
        this.userDataDir = options.userDataDir || os.tmpdir();
        this.driveRoots = options.driveRoots || null;
        this.configuredRoots = options.configuredRoots || [];
        this.getStoredGames = options.getStoredGames || (() => []);
        this.registry = options.registryAdapter || new WindowsGogRegistryAdapter();
        this.galaxy = options.galaxyAdapter || new GalaxySqliteAdapter({
            databasePath: this.path.join(this.programData, 'GOG.com', 'Galaxy', 'storage', 'galaxy-2.0.db'),
            userDataDir: this.userDataDir,
            fsApi: this.fs,
            pathApi: this.path,
        });
        this.findLikelyGameExe = options.findLikelyGameExe || (() => null);
        this.signal = options.signal || null;
        this.clock = options.clock || (() => Date.now());
        this.limits = { ...DEFAULT_LIMITS, ...(options.limits || {}) };
        this.rootCachePath = this.path.join(this.userDataDir, 'gog-scanner-roots.json');
    }

    _throwIfStopped(deadline) {
        if (this.signal?.aborted) throw Object.assign(new Error('GOG scan cancelled'), { code: 'GOG_SCAN_CANCELLED' });
        if (this.clock() > deadline) throw Object.assign(new Error('GOG scan timed out'), { code: 'GOG_SCAN_TIMED_OUT' });
    }

    _readDownloadState() {
        try {
            const file = this.path.join(this.userDataDir, 'downloads', 'downloads-queue.json');
            const parsed = JSON.parse(this.fs.readFileSync(file, 'utf8'));
            return Array.isArray(parsed.tasks) ? parsed.tasks : [];
        } catch {
            return [];
        }
    }

    _trustedRecords(state) {
        const tasks = this._readDownloadState();
        const completed = tasks.filter(task => cleanString(task.platform).toLowerCase() === 'gog' &&
            cleanString(task.installProvider).toLowerCase() === 'gogdl' && task.status === 'completed' && task.completionConfirmed === true);
        return (this.getStoredGames() || []).filter(record => {
            if (cleanString(record.platform || record.scannerPlatform).toLowerCase() !== 'gog') return false;
            if (cleanString(record.installProvider).toLowerCase() !== 'gogdl' || cleanString(record.installSource).toLowerCase() !== 'download') return false;
            const productId = numericId(record.gogProductId || record.allIds?.gog || record.providerProductId || record.launcherGameId);
            const installPath = canonicalPath(this.path, record.installPath || record.path);
            const executablePath = canonicalPath(this.path, record.executablePath);
            state.candidates += 1;
            if (!productId || !installPath || !executablePath || !isInside(this.path, installPath, executablePath) || !this._isRegularFile(executablePath)) {
                addReason(state, 'GOG_TRUSTED_INSTALL_INVALID');
                return false;
            }
            const matchingTask = completed.find(task => {
                const taskId = numericId(task.gogProductId || task.providerProductId || task.contentSystemProductId || task.gogdlAppName);
                return taskId === productId && pathKey(this.path, task.installPath) === pathKey(this.path, installPath);
            });
            record.__gogTrustedTaskMatched = Boolean(matchingTask);
            return true;
        }).map(record => this._makeGame({
            productId: numericId(record.gogProductId || record.allIds?.gog || record.providerProductId || record.launcherGameId),
            installPath: canonicalPath(this.path, record.installPath || record.path),
            executablePath: canonicalPath(this.path, record.executablePath),
            title: record.name || record.title,
            launchArgs: record.launchArgs || [],
            provenance: 'gogdl',
            sources: ['baddel'],
            manifestPath: record.gogManifestPath || null,
            existing: record,
        }));
    }

    _isRegularFile(filePath) {
        try {
            const stat = this.fs.lstatSync(filePath);
            return stat.isFile() && !stat.isSymbolicLink() && !isUnsafeExecutableName(filePath);
        } catch {
            return false;
        }
    }

    _registryRoots(entries, state) {
        const roots = [];
        for (const entry of entries || []) {
            state.candidates += 1;
            const publisher = cleanString(entry.Publisher);
            const uninstall = cleanString(entry.UninstallString);
            const keyName = cleanString(entry.KeyName);
            const strongGogEvidence = /gog(?:\.com)?/i.test(publisher) || /gog(?:\.com)?|goggame-/i.test(uninstall) || /^\d{8,}$/.test(keyName);
            if (!strongGogEvidence) { addReason(state, 'GOG_REGISTRY_EVIDENCE_WEAK'); continue; }
            let candidate = canonicalPath(this.path, entry.InstallLocation);
            if (!candidate) {
                const icon = canonicalPath(this.path, cleanRegistryPath(entry.DisplayIcon));
                const uninstaller = canonicalPath(this.path, cleanRegistryPath(uninstall));
                candidate = icon ? this.path.dirname(icon) : (uninstaller ? this.path.dirname(uninstaller) : null);
            }
            if (!candidate || !this._isDirectory(candidate)) { addReason(state, 'GOG_REGISTRY_PATH_STALE'); continue; }
            roots.push({ path: candidate, source: 'registry' });
        }
        return roots;
    }

    _isDirectory(value) {
        try {
            const stat = this.fs.lstatSync(value);
            return stat.isDirectory() && !stat.isSymbolicLink();
        } catch {
            return false;
        }
    }

    _cachedRoots() {
        try {
            const parsed = JSON.parse(this.fs.readFileSync(this.rootCachePath, 'utf8'));
            if (parsed.version !== ROOT_CACHE_VERSION || !Array.isArray(parsed.roots)) return [];
            return parsed.roots.map(root => ({ path: root, source: 'cache' }));
        } catch {
            return [];
        }
    }

    _settingsRoots() {
        try {
            const file = this.path.join(this.userDataDir, 'downloads', 'downloads-queue.json');
            const parsed = JSON.parse(this.fs.readFileSync(file, 'utf8'));
            const root = parsed.settings?.defaultInstallRoots?.gog;
            return root ? [{ path: root, source: 'configured' }] : [];
        } catch {
            return [];
        }
    }

    _dedupeRoots(roots) {
        const result = [];
        const seen = new Set();
        for (const root of roots) {
            const canonical = canonicalPath(this.path, root?.path || root);
            const key = pathKey(this.path, canonical);
            if (!canonical || !key || seen.has(key) || !this._isDirectory(canonical)) continue;
            seen.add(key);
            result.push({ path: canonical, source: root?.source || 'known-root' });
            if (result.length >= this.limits.maxRoots) break;
        }
        return result;
    }

    async _manifestFiles(roots, state, deadline) {
        const manifests = [];
        let entryCount = 0;
        const queue = roots.map(root => ({ ...root, depth: 0, boundary: root.path }));
        while (queue.length) {
            this._throwIfStopped(deadline);
            const batch = queue.splice(0, this.limits.concurrency);
            const results = await Promise.all(batch.map(async item => {
                try {
                    const real = await this.fs.promises.realpath(item.path);
                    const realBoundary = await this.fs.promises.realpath(item.boundary);
                    if (!isInside(this.path, realBoundary, real)) return { item, entries: [], escaped: true };
                    const stat = await this.fs.promises.lstat(item.path);
                    if (!stat.isDirectory() || stat.isSymbolicLink()) return { item, entries: [] };
                    return { item, entries: await this.fs.promises.readdir(item.path, { withFileTypes: true }) };
                } catch (error) {
                    return { item, entries: [], error };
                }
            }));
            for (const result of results) {
                if (result.escaped) { addReason(state, 'GOG_SCAN_REPARSE_ESCAPE'); continue; }
                for (const entry of result.entries) {
                    entryCount += 1;
                    if (entryCount > this.limits.maxEntries) throw Object.assign(new Error('GOG entry limit reached'), { code: 'GOG_SCAN_ENTRY_LIMIT' });
                    const full = this.path.join(result.item.path, entry.name);
                    if (entry.isFile() && MANIFEST_RE.test(entry.name)) manifests.push({ path: full, rootHintSource: result.item.source });
                    else if (entry.isDirectory() && !entry.isSymbolicLink() && result.item.depth < this.limits.maxDepth) {
                        queue.push({ path: full, source: result.item.source, depth: result.item.depth + 1, boundary: result.item.boundary });
                    }
                }
            }
        }
        state.entriesVisited = entryCount;
        state.manifestsFound = manifests.length;
        return manifests;
    }

    async _readManifest(file, state) {
        try {
            const stat = await this.fs.promises.lstat(file.path);
            if (!stat.isFile() || stat.isSymbolicLink()) { addReason(state, 'GOG_MANIFEST_NOT_REGULAR'); return null; }
            if (stat.size <= 0 || stat.size > this.limits.maxManifestBytes) { addReason(state, 'GOG_MANIFEST_OVERSIZED'); return null; }
            const parsed = JSON.parse(await this.fs.promises.readFile(file.path, 'utf8'));
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid object');
            return { parsed, manifestPath: file.path, installPath: this.path.dirname(file.path), source: file.rootHintSource };
        } catch (error) {
            addReason(state, error instanceof SyntaxError ? 'GOG_MANIFEST_MALFORMED' : 'GOG_MANIFEST_READ_FAILED');
            return null;
        }
    }

    _manifestIdentity(item, state) {
        const data = item.parsed;
        const productId = numericId(data.gameId || data.productId || data.product_id || data.id);
        if (!productId) { addReason(state, 'GOG_IDENTITY_UNVERIFIED'); return null; }
        const rootProductId = numericId(data.rootGameId || data.rootProductId || data.baseGameId || data.parentGameId);
        const type = cleanString(data.productType || data.type || data.contentType).toLowerCase();
        const isDlc = data.isDlc === true || data.dlc === true || ['dlc', 'bonus', 'extra', 'language_pack', 'dependency', 'soundtrack'].includes(type) || (rootProductId && rootProductId !== productId);
        return { productId, rootProductId, isDlc };
    }

    _resolveExecutable(item, identity, state) {
        const tasks = Array.isArray(item.parsed.playTasks) ? item.parsed.playTasks : [];
        const ordered = [...tasks].sort((a, b) => Number(Boolean(b?.isPrimary)) - Number(Boolean(a?.isPrimary)));
        let unsafeExplicitPath = false;
        for (const task of ordered) {
            if (!task || typeof task !== 'object') continue;
            const category = cleanString(task.category || task.type).toLowerCase();
            if (category && !['game', 'play', 'launcher'].includes(category)) continue;
            const rawPath = cleanString(task.path || task.executablePath || task.executable);
            if (!rawPath) continue;
            const resolved = canonicalPath(this.path, this.path.isAbsolute(rawPath) ? rawPath : this.path.resolve(item.installPath, rawPath));
            if (!resolved || !isInside(this.path, item.installPath, resolved)) {
                unsafeExplicitPath = true;
                addReason(state, 'GOG_EXECUTABLE_PATH_TRAVERSAL');
                continue;
            }
            if (!this._isRegularFile(resolved)) { addReason(state, 'GOG_EXECUTABLE_REJECTED'); continue; }
            let cwd = item.installPath;
            if (task.workingDir) {
                const resolvedCwd = canonicalPath(this.path, this.path.isAbsolute(task.workingDir) ? task.workingDir : this.path.resolve(item.installPath, task.workingDir));
                if (resolvedCwd && isInside(this.path, item.installPath, resolvedCwd) && this._isDirectory(resolvedCwd)) cwd = resolvedCwd;
            }
            return { executablePath: resolved, launchArgs: parseWindowsArgs(task.arguments || task.commandLineArgs), launchCwd: cwd };
        }
        if (unsafeExplicitPath) return null;
        const fallback = this.findLikelyGameExe(item.installPath, { nameHint: item.parsed.name || item.parsed.title, maxDepth: 4, maxEntries: 1000 });
        if (fallback && isInside(this.path, item.installPath, fallback) && this._isRegularFile(fallback)) {
            return { executablePath: fallback, launchArgs: [], launchCwd: this.path.dirname(fallback) };
        }
        addReason(state, 'GOG_EXECUTABLE_NOT_FOUND');
        return null;
    }

    _makeGame(input) {
        const installHash = crypto.createHash('sha1').update(pathKey(this.path, input.installPath)).digest('hex').slice(0, 10);
        const existing = input.existing || {};
        const strongest = PROVENANCE_RANK[existing.installProvider] > PROVENANCE_RANK[input.provenance] ? existing.installProvider : input.provenance;
        const sources = [...new Set([...(existing.discoverySources || []), ...(input.sources || [])])];
        return {
            ...existing,
            id: existing.id || `gog-${input.productId}-${installHash}`,
            canonicalGameId: existing.canonicalGameId || `gog_${input.productId}`,
            name: cleanString(input.title || existing.name || existing.title) || `GOG ${input.productId}`,
            title: cleanString(input.title || existing.title || existing.name) || `GOG ${input.productId}`,
            platform: 'gog',
            scannerPlatform: 'gog',
            source: 'gog',
            installSource: strongest === 'gogdl' ? 'download' : 'scanner',
            installProvider: strongest,
            installProvenance: strongest,
            path: input.installPath,
            installPath: input.installPath,
            executablePath: input.executablePath,
            command: quoteExecutable(input.executablePath),
            launchCommand: quoteExecutable(input.executablePath),
            galaxyLaunchCommand: strongest === 'gog_galaxy' ? `goggalaxy://launch/${input.productId}` : null,
            launchArgs: input.launchArgs || [],
            launchCwd: input.launchCwd || this.path.dirname(input.executablePath),
            gogProductId: input.productId,
            providerProductId: existing.providerProductId || input.productId,
            launcherGameId: input.productId,
            allIds: { ...(existing.allIds || {}), gog: input.productId },
            installedGameKey: `gog:${input.productId}:${installHash}`,
            gogManifestPath: input.manifestPath || existing.gogManifestPath || null,
            discoverySources: sources,
            scanSourceDetail: sources.join('+'),
            discoveryConfidence: strongest === 'gogdl' ? 'trusted' : (strongest === 'gog_galaxy' ? 'high' : 'verified-local-metadata'),
            isInstalled: true,
            installVerified: true,
            needsMetadataEnrichment: !cleanString(input.title),
        };
    }

    _mergeCandidates(candidates, diagnostics) {
        const byInstall = new Map();
        for (const candidate of candidates) {
            const key = `${candidate.gogProductId}:${pathKey(this.path, candidate.installPath || candidate.path)}`;
            const existing = byInstall.get(key);
            if (!existing) { byInstall.set(key, candidate); continue; }
            diagnostics.duplicatesMerged += 1;
            const winner = PROVENANCE_RANK[candidate.installProvider] > PROVENANCE_RANK[existing.installProvider] ? candidate : existing;
            const other = winner === candidate ? existing : candidate;
            winner.discoverySources = [...new Set([...(winner.discoverySources || []), ...(other.discoverySources || [])])];
            winner.scanSourceDetail = winner.discoverySources.join('+');
            if ((!winner.name || /^GOG \d+$/.test(winner.name)) && other.name) winner.name = other.name;
            byInstall.set(key, winner);
        }
        return [...byInstall.values()];
    }

    async scan() {
        const started = this.clock();
        const deadline = started + this.limits.timeoutMs;
        const sources = {
            baddel: sourceState('ready'),
            galaxy: sourceState('unavailable'),
            registry: sourceState('unavailable'),
            filesystem: sourceState('ready'),
        };
        const diagnostics = { sources, duplicatesMerged: 0, validatedGames: 0, durationMs: 0, deletionReady: false };
        const candidates = [];
        const roots = [];

        const trusted = this._trustedRecords(sources.baddel);
        sources.baddel.accepted = trusted.length;
        candidates.push(...trusted);
        roots.push(...trusted.map(game => ({ path: game.installPath, source: 'baddel' })));

        const [galaxyResult, registryResult] = await Promise.all([
            this.galaxy.readInstalledGames(),
            this.registry.listEntries(),
        ]);
        sources.galaxy.status = galaxyResult.status || 'failed';
        sources.galaxy.error = galaxyResult.error || null;
        sources.galaxy.candidates = galaxyResult.rows?.length || 0;
        const galaxyByKey = new Map();
        for (const row of galaxyResult.rows || []) {
            const productId = numericId(row.productId);
            const installPath = canonicalPath(this.path, row.installationPath);
            if (!productId || !installPath || !this._isDirectory(installPath)) { addReason(sources.galaxy, 'GOG_GALAXY_ROW_STALE'); continue; }
            galaxyByKey.set(`${productId}:${pathKey(this.path, installPath)}`, row);
            roots.push({ path: installPath, source: 'galaxy' });
        }

        sources.registry.status = registryResult.status || 'failed';
        sources.registry.error = registryResult.error || null;
        roots.push(...this._registryRoots(registryResult.entries, sources.registry));
        roots.push(...(this.getStoredGames() || []).filter(game => cleanString(game.platform || game.scannerPlatform).toLowerCase() === 'gog').map(game => ({ path: game.installPath || game.path, source: 'saved-record' })));
        roots.push(...this._cachedRoots(), ...this._settingsRoots());
        roots.push(...this.configuredRoots.map(root => ({ path: root, source: 'configured' })));
        for (const drive of this.driveRoots || []) roots.push({ path: this.path.join(drive, 'GOG Games'), source: 'conventional' });

        const boundedRoots = this._dedupeRoots(roots);
        sources.filesystem.candidates = boundedRoots.length;
        try {
            const manifestFiles = await this._manifestFiles(boundedRoots, sources.filesystem, deadline);
            const parsed = (await Promise.all(manifestFiles.map(file => this._readManifest(file, sources.filesystem)))).filter(Boolean);
            const grouped = new Map();
            for (const item of parsed) {
                const key = pathKey(this.path, item.installPath);
                if (!grouped.has(key)) grouped.set(key, []);
                grouped.get(key).push(item);
            }
            for (const group of grouped.values()) {
                const identified = group.map(item => ({ item, identity: this._manifestIdentity(item, sources.filesystem) })).filter(x => x.identity);
                const bases = identified.filter(x => !x.identity.isDlc);
                const distinctBaseIds = new Set(bases.map(x => x.identity.productId));
                if (distinctBaseIds.size > 1) {
                    for (const ignored of bases) addReason(sources.filesystem, 'GOG_BASE_IDENTITY_AMBIGUOUS');
                    continue;
                }
                const base = bases[0];
                if (!base) continue;
                const launch = this._resolveExecutable(base.item, base.identity, sources.filesystem);
                if (!launch) continue;
                const installPath = base.item.installPath;
                const galaxyRow = galaxyByKey.get(`${base.identity.productId}:${pathKey(this.path, installPath)}`);
                const trustedMatch = trusted.find(game => game.gogProductId === base.identity.productId && pathKey(this.path, game.installPath) === pathKey(this.path, installPath));
                const provenance = trustedMatch ? 'gogdl' : (galaxyRow ? 'gog_galaxy' : 'gog_discovered');
                const sourceList = [...new Set([base.item.source || 'filesystem', 'manifest', ...(galaxyRow ? ['galaxy'] : []), ...(trustedMatch ? ['baddel'] : [])])];
                candidates.push(this._makeGame({
                    productId: base.identity.productId,
                    installPath,
                    executablePath: launch.executablePath,
                    launchArgs: launch.launchArgs,
                    launchCwd: launch.launchCwd,
                    title: base.item.parsed.name || base.item.parsed.title || galaxyRow?.title,
                    provenance,
                    sources: sourceList,
                    manifestPath: base.item.manifestPath,
                    existing: trustedMatch || null,
                }));
                sources.filesystem.accepted += 1;
                if (galaxyRow) sources.galaxy.accepted += 1;
                if (base.item.source === 'registry') sources.registry.accepted += 1;
            }
        } catch (error) {
            sources.filesystem.status = error.code === 'GOG_SCAN_TIMED_OUT' ? 'timed_out' : (error.code === 'GOG_SCAN_CANCELLED' ? 'cancelled' : 'partial');
            sources.filesystem.error = error.code || 'GOG_FILESYSTEM_SCAN_FAILED';
        }

        const games = this._mergeCandidates(candidates, diagnostics);
        diagnostics.validatedGames = games.length;
        diagnostics.durationMs = this.clock() - started;
        diagnostics.deletionReady = sources.filesystem.status === 'ready' &&
            !['failed', 'timed_out', 'partial', 'cancelled'].includes(sources.galaxy.status) &&
            !['failed', 'timed_out', 'partial', 'cancelled'].includes(sources.registry.status);
        const validatedRoots = [...new Set(games.map(game => game.installPath).filter(Boolean))];
        try {
            await this.fs.promises.mkdir(this.path.dirname(this.rootCachePath), { recursive: true });
            const temp = this.rootCachePath + '.tmp';
            await this.fs.promises.writeFile(temp, JSON.stringify({ version: ROOT_CACHE_VERSION, roots: validatedRoots }, null, 2), 'utf8');
            await this.fs.promises.rename(temp, this.rootCachePath);
        } catch { /* cache is optional */ }
        return { games, diagnostics, deletionReady: diagnostics.deletionReady };
    }
}

module.exports = {
    GogInstalledGamesScanner,
    WindowsGogRegistryAdapter,
    GalaxySqliteAdapter,
    DEFAULT_LIMITS,
    PROVENANCE_RANK,
    numericId,
    cleanRegistryPath,
    canonicalPath,
    isInside,
    isUnsafeExecutableName,
    parseWindowsArgs,
};
