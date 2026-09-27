'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const {
    inspectLegendaryRuntime,
    createLegendaryRuntimeMissingError,
} = require('../../../../../shared/legendaryRuntimeResolver');
const { makeDownloadError } = require('../../services/DownloadPreflightService');

function redactLegendaryText(value) {
    return String(value || '')
        .replace(/(["']?(?:access_token|refresh_token|authorization|authorization_code|exchange_code|cookie|sid)["']?\s*[=:]\s*)(?:"[^"]*"|'[^']*'|(?:Bearer\s+)?[^\s,}\]]+)/ig, '$1[REDACTED]')
        .slice(-4000);
}

function legendaryFailureCode(value) {
    const text = String(value || '');
    if (!/error|failed|failure|invalid|expired|unauthorized|forbidden/i.test(text)) return null;
    if (/auth|login|token|unauthorized|forbidden|credential|401|403/i.test(text)) return 'EPIC_AUTH_REQUIRED';
    if (/not own|ownership|entitlement/i.test(text)) return 'EPIC_GAME_NOT_OWNED';
    if (/no space|disk full|not enough.*space/i.test(text)) return 'DOWNLOAD_INSUFFICIENT_DISK_SPACE';
    if (/\b(?:ERROR|FATAL|CRITICAL)\s*:/i.test(text)) return 'EPIC_LEGENDARY_PROCESS_FAILED';
    return null;
}

function normalizeFsPath(value) {
    return value ? path.resolve(String(value)).replace(/\\/g, '/').replace(/\/+$/g, '').toLowerCase() : '';
}

function installedEntries(payload) {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== 'object') return [];
    return Object.entries(payload).map(([appName, record]) => ({ app_name: appName, ...(record && typeof record === 'object' ? record : {}) }));
}

class EpicLegendaryRuntimeService {
    constructor({ projectRoot, resourcesPath, isPackaged = false, spawnFn = spawn, fsSync = fs } = {}) {
        this.runtimeOptions = { projectRoot, resourcesPath, isPackaged };
        this.spawn = spawnFn;
        this.fs = fsSync;
    }

    getRuntime() {
        const runtime = inspectLegendaryRuntime(this.runtimeOptions);
        if (!runtime.exists) throw createLegendaryRuntimeMissingError(runtime.legendaryPath);
        return runtime;
    }

    makeEnv(configPath) {
        return { ...process.env, LEGENDARY_CONFIG_PATH: configPath };
    }

    createProcess(args, configPath) {
        const runtime = this.getRuntime();
        return this.spawn(runtime.legendaryPath, args.map(String), {
            env: this.makeEnv(configPath),
            shell: false,
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
    }

    terminateProcess(child) {
        if (!child?.pid) return child?.kill?.();
        if (process.platform !== 'win32') return child.kill('SIGTERM');
        const killer = this.spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
            shell: false, windowsHide: true, stdio: 'ignore',
        });
        killer.once('error', () => { child.kill?.(); });
        return killer;
    }

    async run(args, configPath, { captureOutput = false } = {}) {
        return new Promise((resolve, reject) => {
            const child = this.createProcess(args, configPath);
            let stdout = '';
            let stderr = '';
            child.stdout?.on?.('data', chunk => { stdout = (stdout + chunk).slice(-16384); });
            child.stderr?.on?.('data', chunk => { stderr = (stderr + chunk).slice(-16384); });
            child.once?.('error', () => reject(makeDownloadError('EPIC_LEGENDARY_PROCESS_FAILED', 'Legendary could not start the Epic operation.')));
            // A launched game can inherit the pipes after Legendary itself exits.
            child.once?.(args[0] === 'launch' ? 'exit' : 'close', (code, signal) => {
                const raw = redactLegendaryText(stderr || stdout);
                if (code === 0 && !legendaryFailureCode(raw)) return resolve({
                    code,
                    signal,
                    ...(captureOutput ? { stdout: redactLegendaryText(stdout), stderr: redactLegendaryText(stderr) } : {}),
                });
                const auth = legendaryFailureCode(raw) === 'EPIC_AUTH_REQUIRED';
                const error = makeDownloadError(auth ? 'EPIC_AUTH_REQUIRED' : 'EPIC_LEGENDARY_PROCESS_FAILED', auth ? 'Reconnect the selected Epic account and try again.' : 'Legendary could not complete the Epic operation.');
                error.details = { code, signal };
                reject(error);
            });
        });
    }

    async getGameInfo({ appName, configPath }) {
        const result = await this.run(['info', String(appName), '--json', '--platform', 'Windows'], configPath, { captureOutput: true });
        try {
            return JSON.parse(String(result.stdout || '').trim());
        } catch {
            throw makeDownloadError('EPIC_UPDATE_CHECK_FAILED', 'Legendary did not return valid Epic version information.');
        }
    }

    readInstalled(configPath) {
        try {
            return installedEntries(JSON.parse(this.fs.readFileSync(path.join(configPath, 'installed.json'), 'utf8')));
        } catch {
            return [];
        }
    }

    findInstalled(configPath, appName) {
        return this.readInstalled(configPath).find(record => String(record.app_name || record.appName || '') === String(appName)) || null;
    }

    installationPath(record = {}) {
        return record.install_path || record.installPath || record.path || null;
    }

    async ensureImported({ appName, installPath, configPath }) {
        const current = this.findInstalled(configPath, appName);
        if (current && normalizeFsPath(this.installationPath(current)) === normalizeFsPath(installPath)) return { imported: false, record: current };
        await this.run(['-y', 'import', appName, installPath, '--skip-dlcs', '--platform', 'Windows'], configPath);
        const imported = this.findInstalled(configPath, appName);
        if (!imported || normalizeFsPath(this.installationPath(imported)) !== normalizeFsPath(installPath)) {
            throw makeDownloadError('EPIC_LEGENDARY_IMPORT_FAILED', 'Legendary could not register the existing installation for this account.');
        }
        return { imported: true, record: imported };
    }

    async launch({ appName, installPath, configPath }) {
        const registration = await this.ensureImported({ appName, installPath, configPath });
        await this.run(['launch', appName, '--skip-version-check'], configPath);
        return { status: 'success', imported: registration.imported };
    }
}

module.exports = { EpicLegendaryRuntimeService, installedEntries, normalizeFsPath, redactLegendaryText, legendaryFailureCode };
