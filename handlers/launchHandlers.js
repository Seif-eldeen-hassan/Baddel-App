'use strict';
const { spawn } = require('child_process');
const nodePath = require('path');
const gogGalaxyProtocol = require('../services/gogGalaxyProtocol');

function buildExecutableLaunchArgs(executablePath, launchArgs = []) {
    const args = Array.isArray(launchArgs) ? launchArgs.map(value => String(value)) : [];
    if (nodePath.basename(String(executablePath || '')).toLowerCase() !== 'scummvm.exe') return args;
    return [...args.filter(value => !/^--(?:no-)?console(?:=|$)/i.test(value)), '--no-console'];
}

function resolveTrustedLaunchCommand(trusted = {}, options = {}) {
    const galaxyCommand = options.preferGalaxyLaunch === true &&
        trusted.installProvider === 'gog_galaxy' &&
        gogGalaxyProtocol.isLaunchUrl(trusted.galaxyLaunchCommand)
        ? trusted.galaxyLaunchCommand
        : null;
    return galaxyCommand || trusted.command || trusted.path || '';
}

module.exports.buildExecutableLaunchArgs = buildExecutableLaunchArgs;
module.exports.resolveTrustedLaunchCommand = resolveTrustedLaunchCommand;

// deps shape: {
//   getSavedGames,       ← gameScanner.getSavedGames
//   startGameTracking,   ← function in main.js (passed by reference)
//   _detectPlatform,     ← function in main.js (passed by reference)
//   shell,               ← electron shell
//   fsSync,              ← require('fs')
//   path,                ← require('path')
//   safeLauncher,        ← services/safeLauncher
//   analytics,           ← analytics module
//   app,                 ← electron app
// }
//
// Intentionally NOT moved here:
//   startGameTracking    — playtime-engine domain; stays in main.js
//   _detectPlatform      — also used by startGameTracking and playtimeHandlers
//   activeTrackers       — stays in main.js (ownership); playtimeHandlers gets a ref
//   _endTrackerSession   — playtime-engine domain; stays in main.js
//   startGlobalWatcher   — co-located with the tracking engine in main.js

module.exports.register = function registerLaunchHandlers(ipcMain, deps) {
    const { getSavedGames, startGameTracking, _detectPlatform, shell, fsSync, path, safeLauncher, analytics, app, launcherPathResolver } = deps;

    const _launchInFlight  = new Set();
    const _installInFlight = new Set();

    const COLD_START_GRACE_MS     = 2000;
    const ACCOUNT_SWITCH_GRACE_MS = 6000;

    const EPIC_WARM_RETRY_DELAYS_MS = [2000];  // reserved for future warm-retry tuning

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
            gog: {
                name: 'GOG Galaxy',
                resolver: async () => launcherPathResolver?.findLauncherExe?.('gog'),
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
            command  = resolveTrustedLaunchCommand(trusted, options);
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
                const isGog   = cleanCmd.startsWith('goggalaxy://');
                if (isGog && !gogGalaxyProtocol.isLaunchUrl(cleanCmd)) {
                    return launchError('GOG_LAUNCH_URL_INVALID', 'Invalid GOG Galaxy launch URL.');
                }

                const PROCESS_NAMES = {
                    // Do NOT include EpicWebHelper here — it may be running in the background
                    // while the launcher itself is not yet ready to accept a play command.
                    epic:  ['epicgameslauncher.exe'],
                    steam: ['steam.exe', 'steamwebhelper.exe'],
                    gog:   ['galaxyclient.exe'],
                };

                const platformKey = isEpic ? 'epic' : isSteam ? 'steam' : isGog ? 'gog' : null;
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
                const storedArgs = (trusted?.launchArgs?.length) ? trusted.launchArgs : (_cmdParsed.parsedArgs || []);
                const spawnArgs = buildExecutableLaunchArgs(cleanCmd, storedArgs);
                if (nodePath.basename(cleanCmd).toLowerCase() === 'scummvm.exe') {
                    console.log('[Launch][ScummVM] Console disabled with supported --no-console argument');
                }
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

    ipcMain.handle('launcher:open-install-url', async (event, payload) => {
        const {
            platform,
            installUrl,
            retryOnColdStart    = true,
            forceRetryAfterOpen = false,
            fallbackToStore     = true,   // Steam: open store page after install attempts
        } = payload || {};

        const ALLOWED_PLATFORMS = ['steam', 'epic', 'gog'];
        const PROTOCOL_MAP = {
            epic:  'com.epicgames.launcher://',
            steam: 'steam://',
            gog:   'goggalaxy://',
        };
        const PROCESS_NAMES = {
            epic:  ['epicgameslauncher.exe'],
            steam: ['steam.exe', 'steamwebhelper.exe'],
            gog:   ['galaxyclient.exe'],
        };

        if (!ALLOWED_PLATFORMS.includes(platform)) {
            return { ok: false, error: `Unsupported platform: ${platform}`, platform, installUrl };
        }
        if (!installUrl || !installUrl.startsWith(PROTOCOL_MAP[platform])) {
            return { ok: false, error: `Invalid install URL for ${platform}: ${installUrl}`, platform, installUrl };
        }
        if (platform === 'gog' && !gogGalaxyProtocol.isProductViewUrl(installUrl)) {
            return { ok: false, code: 'GOG_INSTALL_URL_INVALID', error: 'Invalid GOG Galaxy product-view URL.', platform, installUrl };
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
                    if (/^(steam|com\.epicgames\.launcher|goggalaxy):\/\//.test(effectiveInstallUrl)) {
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

            return { ok: true, code: platform === 'gog' ? 'GOG_PRODUCT_VIEW_DISPATCHED' : undefined, dispatched: true, installStarted: platform === 'gog' ? false : undefined, platform, installUrl: effectiveInstallUrl, attempts, coldStartRetryUsed, forceRetryAfterOpen, fallbackStoreUsed, wasRunning, appid };
        } catch (e) {
            console.error(`[InstallOpener] Error:`, e);
            return { ok: false, error: e.message, platform, installUrl: effectiveInstallUrl, appid };
        } finally {
            _installInFlight.delete(key);
        }
    });
};
