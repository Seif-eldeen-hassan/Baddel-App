'use strict';

const fs = require('fs');
const { epicTrace } = require('../../services/EpicDownloadTrace');
const path = require('path');
const { EpicLegendaryProgressParser } = require('./EpicLegendaryProgressParser');
const { normalizeFsPath, legendaryFailureCode } = require('./EpicLegendaryRuntimeService');
const { makeDownloadError } = require('../../services/DownloadPreflightService');

function scanInstallation(root, fsSync = fs) {
    const result = { actualBytes: 0, fileCount: 0, executablePath: null };
    const walk = directory => {
        for (const entry of fsSync.readdirSync(directory, { withFileTypes: true })) {
            const full = path.join(directory, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.isFile()) {
                result.actualBytes += fsSync.statSync(full).size;
                result.fileCount += 1;
                if (!result.executablePath && entry.name.toLowerCase().endsWith('.exe') && !/unins|setup|launcher|crash/i.test(entry.name)) result.executablePath = full;
            }
        }
    };
    try { walk(root); } catch {}
    return result;
}

function normalizeEpicError(error) {
    if (error?.code && /^(EPIC_|DOWNLOAD_)/.test(String(error.code))) return error;
    const text = String(error?.message || '');
    if (/auth|login|token|unauthorized|forbidden/i.test(text)) return makeDownloadError('EPIC_AUTH_REQUIRED', 'Reconnect the selected Epic account and try again.');
    if (/no space|disk full/i.test(text)) return makeDownloadError('DOWNLOAD_INSUFFICIENT_DISK_SPACE', 'There is not enough free disk space for this download.');
    return makeDownloadError('EPIC_LEGENDARY_PROCESS_FAILED', 'Legendary could not complete the Epic download.');
}

class EpicLegendaryDownloadAdapter {
    constructor({ runtimeService, accountResolver, fsSync = fs, startupProgressTimeoutMs = 120000, stopTimeoutMs = 5000 } = {}) {
        this.runtime = runtimeService;
        this.accountResolver = accountResolver;
        this.fs = fsSync;
        this.startupProgressTimeoutMs = startupProgressTimeoutMs;
        this.stopTimeoutMs = stopTimeoutMs;
        this.active = new Map();
    }

    supports(task = {}) {
        return String(task.platform || '').toLowerCase() === 'epic' && String(task.installProvider || '').toLowerCase() === 'legendary';
    }

    async ensureMaintenanceRegistration(task, resolved) {
        const taskPath = normalizeFsPath(task.installPath);
        const installed = this.runtime.findInstalled(resolved.configPath, resolved.appName);
        if (installed) {
            if (normalizeFsPath(this.runtime.installationPath(installed)) !== taskPath) {
                throw makeDownloadError('EPIC_INSTALL_PATH_MISMATCH', 'Legendary has this Epic game registered at a different installation path.');
            }
            return installed;
        }
        try {
            if (!taskPath || !this.fs.statSync(task.installPath).isDirectory()) {
                throw makeDownloadError('EPIC_INSTALLATION_NOT_FOUND', 'The Baddel-managed Epic installation folder could not be found.');
            }
        } catch (error) {
            if (error?.code === 'EPIC_INSTALLATION_NOT_FOUND') throw error;
            throw makeDownloadError('EPIC_INSTALLATION_NOT_FOUND', 'The Baddel-managed Epic installation folder could not be found.');
        }
        if (typeof this.runtime.ensureImported !== 'function') {
            throw makeDownloadError('EPIC_INSTALLED_RECORD_MISSING', 'Legendary is missing this installation record for the selected Epic account.');
        }
        const imported = await this.runtime.ensureImported({
            appName: resolved.appName,
            installPath: task.installPath,
            configPath: resolved.configPath,
        });
        return imported?.record || this.runtime.findInstalled(resolved.configPath, resolved.appName);
    }

    async getCapabilityStatus() {
        try {
            const runtime = this.runtime.getRuntime();
            return {
                provider: 'legendary', platform: 'epic', available: true,
                runtimePath: runtime.legendaryPath,
                supportsDownload: true, supportsResume: true,
                supportsUpdate: true, supportsRepair: true,
            };
        } catch (error) {
            return {
                provider: 'legendary', platform: 'epic', available: false,
                supportsDownload: false, supportsResume: false,
                supportsUpdate: false, supportsRepair: false,
                errorCode: error.code || 'EPIC_LEGENDARY_RUNTIME_MISSING',
            };
        }
    }

    async checkForUpdate(task) {
        const resolved = await this.accountResolver.validateTask(task);
        const installed = await this.ensureMaintenanceRegistration(task, resolved);
        const info = await this.runtime.getGameInfo({ appName: resolved.appName, configPath: resolved.configPath });
        const installedBuildId = String(installed.version || task.buildVersion || task.buildId || '').trim() || null;
        const targetBuildId = String(
            info?.game?.platform_versions?.Windows || info?.manifest?.build_version || info?.game?.version || ''
        ).trim() || null;
        if (!installedBuildId || !targetBuildId) {
            throw makeDownloadError('EPIC_UPDATE_VERSION_UNRESOLVED', 'Legendary could not compare the installed and current Epic versions.');
        }
        return {
            provider: 'epic', appName: resolved.appName,
            installedBuildId, targetBuildId,
            updateAvailable: installedBuildId !== targetBuildId,
            checkedAt: new Date().toISOString(),
        };
    }

    async start(task, { onProgress = () => {} } = {}) {
        if (!this.supports(task)) throw makeDownloadError('EPIC_INSTALL_PROVIDER_INVALID', 'This task is not an Epic Legendary download.');
        if (!task.installPath || !path.isAbsolute(task.installPath)) throw makeDownloadError('EPIC_INSTALL_PATH_INVALID', 'Choose a valid Epic installation path.');
        if (this.active.has(task.id)) throw makeDownloadError('EPIC_DOWNLOAD_ALREADY_RUNNING', 'The previous Epic downloader has not stopped yet.');
        const state = { child: null, stopping: null, lastDownloaded: 0, lastTotal: 0, receivedProgress: false, exited: false, failureCode: null };
        state.closed = new Promise(resolve => { state.confirmExit = resolve; });
        this.active.set(task.id, state);
        let resolved;
        let child;
        try {
            resolved = await this.accountResolver.validateTask(task);
            if (state.stopping) throw makeDownloadError('EPIC_DOWNLOAD_STOPPED', 'Epic download stopped before starting.');
            const operationKind = ['update', 'repair'].includes(task.operationKind) ? task.operationKind : 'install';
            if (operationKind !== 'install' && typeof this.runtime.findInstalled === 'function') {
                await this.ensureMaintenanceRegistration(task, resolved);
            }
            if (operationKind === 'install' && String(task.providerAppName || task.appName || '') && String(task.providerAppName || task.appName) !== resolved.appName) {
                throw makeDownloadError('EPIC_APP_NAME_UNRESOLVED', 'The queued Epic app identity no longer matches the synced library.');
            }

            const args = ['-y', 'install', resolved.appName, '--base-path', path.dirname(task.installPath), '--game-folder', path.basename(task.installPath), '--skip-sdl', '--skip-dlcs', '--platform', 'Windows'];
            if (operationKind === 'update') args.push('--update-only');
            if (operationKind === 'repair') args.push('--repair');
            let debugSupported = false;
            if (epicTrace.isEnabled()) {
                debugSupported = await epicTrace.begin(task, this.runtime, resolved.configPath);
                if (state.stopping) throw makeDownloadError('EPIC_DOWNLOAD_STOPPED', 'Epic download stopped before starting.');
                if (debugSupported === true) args.push('--dlm-debug');
            }
            epicTrace.record(task.id, 'INSTALL_SPAWN', { operationKind, args, configPath: resolved.configPath, debugEnabled: debugSupported === true });
            child = this.runtime.createProcess(args, resolved.configPath);
            state.child = child;
        } catch (error) {
            this.active.delete(task.id);
            state.confirmExit(true);
            throw normalizeEpicError(error);
        }
        const stdoutParser = new EpicLegendaryProgressParser({ onLine: (line, event) => epicTrace.parser(task.id, 'stdout', line, event) });
        const stderrParser = new EpicLegendaryProgressParser({ onLine: (line, event) => epicTrace.parser(task.id, 'stderr', line, event) });

        return new Promise((resolve, reject) => {
            let settled = false;
            let progressTimer = null;
            const finishReject = error => {
                if (settled) return;
                epicTrace.record(task.id, 'ADAPTER_REJECT', { errorCode: error?.code, message: error?.message, failureCode: state.failureCode });
                settled = true;
                clearTimeout(progressTimer);
                if (state.exited || !state.child?.pid) this.active.delete(task.id);
                reject(normalizeEpicError(error));
            };
            const emit = event => {
                if (state.stopping || settled) return;
                const traceBefore = epicTrace.has(task.id) ? { lastDownloaded: state.lastDownloaded, lastTotal: state.lastTotal } : null;
                state.receivedProgress = state.receivedProgress || event.downloadedBytes != null || event.progressPercent != null;
                if (event.downloadedBytes != null) state.lastDownloaded = Math.max(state.lastDownloaded, event.downloadedBytes);
                if (event.totalBytes != null) state.lastTotal = Math.max(state.lastTotal, event.totalBytes);
                const patch = Object.fromEntries(Object.entries(event).filter(([, value]) => value != null));
                // Retain announced size locally until a real byte counter completes the tuple.
                if (event.downloadedBytes == null) delete patch.totalBytes;
                const adapterPatch = {
                    ...patch,
                    ...(event.totalBytes > 0 && !(task.downloadSizeBytes > 0) ? { downloadSizeBytes: event.totalBytes, downloadSizeSource: 'legendary-runtime-transfer' } : {}),
                    eventType: 'legendary-progress',
                    processPid: child.pid || null,
                    ...(event.progressPercent == null ? {} : { providerReportedPercent: event.progressPercent }),
                    ...(event.downloadedBytes == null ? {} : {
                        providerDownloadedBytes: event.downloadedBytes,
                        rawDownloadedBytes: event.downloadedBytes,
                        ...(state.lastTotal > 0 ? { totalBytes: state.lastTotal, providerTotalBytes: state.lastTotal, authoritativeTransfer: true, providerProgressMode: 'absolute' } : {}),
                    }),
                    ...(event.downloadSpeedBps == null ? {} : { rawDownloadSpeedBps: event.downloadSpeedBps }),
                    progressSource: event.downloadedBytes != null && state.lastTotal > 0 ? 'legendary-transfer-bytes' : 'legendary-telemetry',
                    ...(event.etaSeconds == null ? {} : { etaSource: 'legendary', etaUpdatedAt: new Date().toISOString() }),
                    ...(event.diskUsageBps == null ? {} : { telemetryState: 'supported', diskWriteSpeedBps: event.diskUsageBps }),
                };
                epicTrace.adapter(task.id, event, traceBefore, adapterPatch);
                onProgress(adapterPatch);
            };
            const consume = (parser, chunk) => {
                epicTrace.raw(task.id, parser === stdoutParser ? 'stdout' : 'stderr', chunk);
                state.failureText = ((state.failureText || '') + String(chunk)).slice(-4096);
                state.failureCode = legendaryFailureCode(state.failureText) || state.failureCode;
                parser.push(chunk).forEach(emit);
            };
            child.stdout?.on?.('data', chunk => consume(stdoutParser, chunk));
            child.stderr?.on?.('data', chunk => consume(stderrParser, chunk));
            child.once?.('error', finishReject);
            progressTimer = setTimeout(async () => {
                if (state.receivedProgress || state.stopping) return;
                state.timeoutError = makeDownloadError('EPIC_DOWNLOAD_NO_PROGRESS', 'Legendary started but did not report download progress.');
                const stopped = await this.stop(task.id, 'timed out');
                finishReject(stopped.exitConfirmed ? state.timeoutError : makeDownloadError('DOWNLOAD_STOP_NOT_CONFIRMED', 'The Legendary process did not stop after its progress timeout.'));
            }, this.startupProgressTimeoutMs);
            progressTimer.unref?.();

            child.once?.('close', async (code, signal) => {
                clearTimeout(progressTimer);
                epicTrace.endProvider(task.id, code, signal, state.failureCode);
                state.exited = true;
                state.confirmExit(true);
                stdoutParser.flush().forEach(emit);
                stderrParser.flush().forEach(emit);
                if (settled) { this.active.delete(task.id); return; }
                if (state.timeoutError) return finishReject(state.timeoutError);
                if (state.stopping) return finishReject(makeDownloadError('EPIC_DOWNLOAD_STOPPED', `Epic download ${state.stopping}.`));
                if (code !== 0 || state.failureCode) {
                    const error = makeDownloadError(state.failureCode || 'EPIC_LEGENDARY_PROCESS_FAILED', state.failureCode === 'EPIC_AUTH_REQUIRED' ? 'Reconnect the selected Epic account and try again.' : 'Legendary exited before the Epic installation completed.');
                    error.details = { code, signal };
                    return finishReject(error);
                }
                try {
                    await onProgress({ status: 'verifying', stage: 'verifying', statusMessage: 'Verifying files', etaSeconds: null });
                    if (state.stopping) throw makeDownloadError('EPIC_DOWNLOAD_STOPPED', 'Epic download stopped during verification.');
                    const installed = this.runtime.findInstalled(resolved.configPath, resolved.appName);
                    if (!installed || installed.needs_verification === true || normalizeFsPath(this.runtime.installationPath(installed)) !== normalizeFsPath(task.installPath)) {
                        throw makeDownloadError('EPIC_POST_INSTALL_VERIFICATION_FAILED', 'Legendary finished, but its installation record does not match the selected folder.');
                    }
                    const disk = scanInstallation(task.installPath, this.fs);
                    if (installed.executable) {
                        const executable = path.resolve(task.installPath, installed.executable);
                        const relative = path.relative(task.installPath, executable);
                        if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative) || !this.fs.existsSync(executable) || !this.fs.statSync(executable).isFile()) {
                            throw makeDownloadError('EPIC_POST_INSTALL_VERIFICATION_FAILED', 'The executable in the Legendary installation record could not be verified.');
                        }
                        disk.executablePath = executable;
                    }
                    if (!disk.fileCount || !disk.actualBytes || !disk.executablePath) {
                        throw makeDownloadError('EPIC_POST_INSTALL_VERIFICATION_FAILED', 'The Epic installation could not be verified on disk.');
                    }
                    epicTrace.record(task.id, 'POST_INSTALL_VERIFICATION_PASSED', { disk, needsVerification: installed.needs_verification === true, installPathMatched: true });
                    const transferTotal = state.lastTotal || state.lastDownloaded || task.downloadSizeBytes || task.expectedDownloadBytes;
                    // Preserve zero-transfer resume completion, but mark its disk-only
                    // completion denominator so it cannot masquerade as a network size.
                    const total = transferTotal || disk.actualBytes;
                    settled = true;
                    this.active.delete(task.id);
                    resolve({
                        provider: 'epic',
                        processExitCode: 0,
                        completionConfirmed: true,
                        transfer: { downloadedBytes: total, totalBytes: total, source: transferTotal ? 'legendary-install-record' : 'legendary-verified-disk-fallback' },
                        verification: {
                            status: 'passed', method: 'legendary-installed-json-and-disk', actualBytes: disk.actualBytes,
                            verifiedFileCount: disk.fileCount, executableFound: true, executablePath: disk.executablePath, manifestFound: true,
                        },
                        buildId: installed.version || installed.build_id || installed.buildId || null,
                        completedAt: new Date().toISOString(),
                    });
                } catch (error) {
                    finishReject(error);
                }
            });
        });
    }

    async stop(taskId, reason) {
        const state = this.active.get(taskId);
        if (!state) return { requested: false, exitConfirmed: true };
        state.stopping = reason;
        if (!state.child || state.exited) return { requested: true, exitConfirmed: true, pid: state.child?.pid || null };
        let timer;
        const deadline = new Promise(resolve => { timer = setTimeout(() => resolve(false), this.stopTimeoutMs); });
        try {
            if (this.runtime.terminateProcess) this.runtime.terminateProcess(state.child);
            else state.child.kill?.();
            const exitConfirmed = await Promise.race([state.closed, deadline]);
            return { requested: true, exitConfirmed: exitConfirmed === true, pid: state.child.pid || null };
        } catch {
            return { requested: true, exitConfirmed: state.exited, pid: state.child.pid || null };
        } finally {
            clearTimeout(timer);
        }
    }

    pause(taskId) { return this.stop(taskId, 'paused'); }
    cancel(taskId) { return this.stop(taskId, 'cancelled'); }
}

module.exports = { EpicLegendaryDownloadAdapter, normalizeEpicError, scanInstallation };
