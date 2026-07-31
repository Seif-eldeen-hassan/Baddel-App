'use strict';

const defaultFs = require('fs');
const defaultPath = require('path');
const { DOWNLOAD_STATUSES } = require('../../../domain/entities/DownloadTask');
const { GogProgressParser } = require('./GogProgressParser');
const { makeDownloadError } = require('../../services/DownloadPreflightService');
const {
    diagnoseGogDownloadFailure,
} = require('./GogFailureDiagnosis');

const STARTUP_OUTPUT_TIMEOUT_MS = 45_000;
const DIAGNOSTIC_RING_LIMIT = 150;
const SECRET_RE = /(access[_-]?token|refresh[_-]?token|authorization|auth[_-]?code|code|cookie|password|secret)(["'\s:=]+)([^"'\s,}]+)/gi;

class GogDownloadAdapter {
    constructor({
        runtime,
        discovery,
        userDataDir,
        fsSync = defaultFs,
        pathModule = defaultPath,
        platform = 'windows',
        maxWorkers = null,
    } = {}) {
        if (!runtime) throw new Error('GogDownloadAdapter requires runtime');
        if (!discovery) throw new Error('GogDownloadAdapter requires discovery');
        if (!userDataDir) throw new Error('GogDownloadAdapter requires userDataDir');
        this.runtime = runtime;
        this.discovery = discovery;
        this.userDataDir = userDataDir;
        this.fs = fsSync;
        this.path = pathModule;
        this.platform = platform;
        this.maxWorkers = maxWorkers;
        this.active = new Map();
    }

    supports(task) {
        return String(task?.platform || '').toLowerCase() === 'gog';
    }

    getAuthPath(accountId) {
        return this.path.join(this.userDataDir, 'gog', 'accounts', String(accountId), 'auth.json');
    }

    getConfigPath() {
        return this.path.join(this.userDataDir, 'gog', 'gogdl-config');
    }

    ensureConfigPath() {
        const configPath = this.getConfigPath();
        this.fs.mkdirSync(configPath, { recursive: true });
        return configPath;
    }

    getRuntimeEnv() {
        const configPath = this.ensureConfigPath();
        return {
            env: { GOGDL_CONFIG_PATH: configPath },
            configPath,
        };
    }

    getMergedCachePath() {
        return this.path.join(this.userDataDir, 'platform-sync', 'gog_library_merged.json');
    }

    getDiagnosticsDir() {
        return this.path.join(this.userDataDir, 'download-diagnostics');
    }

    getDiagnosticPath(taskId) {
        const safeId = String(taskId || 'unknown').replace(/[^a-z0-9_-]+/gi, '_').slice(0, 80) || 'unknown';
        return this.path.join(this.getDiagnosticsDir(), `${safeId}-gog.json`);
    }

    getProductId(task = {}) {
        const id = normalizeGogProductId(task.gogdlAppName || task.contentSystemProductId);
        if (!id || task.ownershipVerified !== true || task.secureLinkVerified !== true) {
            throw makeDownloadError(
                'GOG_OWNED_IDENTITY_UNRESOLVED',
                'Baddel could not resolve a verified GOG download identity for this game.'
            );
        }
        return id;
    }

    validateTask(task = {}) {
        if (!this.supports(task)) throw makeDownloadError('DOWNLOAD_UNSUPPORTED_PLATFORM', 'This provider is not handled by the GOG downloader.');
        if (!String(task.accountId || '').trim()) throw makeDownloadError('GOG_ACCOUNT_NOT_FOUND', 'Choose a linked GOG account.');
        const authPath = this.getAuthPath(task.accountId);
        if (!this.fs.existsSync(authPath)) throw makeDownloadError('GOG_AUTH_REQUIRED', 'GOG authentication expired. Relink the GOG account and retry.');
        const productId = this.getProductId(task);
        const installPath = String(task.installPath || '').trim();
        if (!installPath || !this.path.isAbsolute(installPath)) throw makeDownloadError('GOG_INVALID_INSTALL_PATH', 'Choose a valid GOG installation folder.');
        const supportPath = String(task.supportPath || this.path.join(installPath, '.baddel-gog-support')).trim();
        const language = String(task.language || 'en-US').trim() || 'en-US';
        const verifiedBuildId = task.verifiedBuildId ? String(task.verifiedBuildId) : null;
        const verifiedBuildGeneration = Number.isFinite(Number(task.verifiedBuildGeneration)) ? Number(task.verifiedBuildGeneration) : null;
        return {
            productId,
            authPath,
            installPath: this.path.normalize(installPath),
            supportPath: this.path.normalize(supportPath),
            language,
            verifiedBuildId,
            verifiedBuildGeneration,
        };
    }

    accountOwnsProduct(accountId, productId) {
        const cachePath = this.getMergedCachePath();
        if (!this.fs.existsSync(cachePath)) return true;
        try {
            const parsed = JSON.parse(this.fs.readFileSync(cachePath, 'utf8'));
            const games = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.games) ? parsed.games : []);
            if (!games.length) return true;
            return games.some((game) => {
                const ids = [
                    game?.productId,
                    game?.appName,
                    game?.gogProductId,
                    game?.allIds?.gog,
                ].map(normalizeGogProductId).filter(Boolean);
                const owners = (Array.isArray(game?.ownedByAccountIds) ? game.ownedByAccountIds : []).map(v => String(v));
                return ids.includes(String(productId)) && (!owners.length || owners.includes(String(accountId)));
            });
        } catch {
            return true;
        }
    }

    buildArgs(task, { forceGen = null } = {}) {
        const validated = this.validateTask(task);
        return this.buildDownloadArgs(validated, { forceGen });
    }

    buildDownloadArgs(validated, { forceGen = null } = {}) {
        return this.buildGogCommandArgs(validated, {
            operation: 'download',
            installPath: validated.installPath,
            forceGen,
        });
    }

    buildGogCommandArgs(validated, { operation, installPath = null, forceGen = null } = {}) {
        const args = [
            '--auth-config-path', validated.authPath,
            operation,
            validated.productId,
        ];
        args.push('--platform', this.platform);
        if (installPath) args.push('--path', installPath);
        if (validated.supportPath) args.push('--support', validated.supportPath);
        args.push('--skip-dlcs');
        if (validated.language) args.push('--lang', validated.language);
        if (this.maxWorkers && Number.isInteger(Number(this.maxWorkers))) {
            args.push('--max-workers', String(this.maxWorkers));
        }
        if (validated.verifiedBuildId) args.push('--build', String(validated.verifiedBuildId));
        if (forceGen) args.push('--force-gen', String(forceGen));
        return args;
    }

    async getCapabilityStatus() {
        const runtimeEnv = this.getRuntimeEnv();
        return this.discovery.getStatus({ env: runtimeEnv.env });
    }

    async start(task, { onProgress = () => {}, sessionId = null } = {}) {
        if (this.active.has(task.id)) throw makeDownloadError('GOG_DOWNLOAD_PROCESS_FAILED', 'This GOG download is already running.');
        const runtimeEnv = this.getRuntimeEnv();
        const capabilities = await this.discovery.discover({ env: runtimeEnv.env });
        const controller = new AbortController();
        const parser = new GogProgressParser();
        let lastProgressAt = 0;
        let lastPercent = Number(task.progressPercent) || 0;
        let lastStatus = task.status;
        let meaningfulProgressSeen = false;
        let finalTransfer = {
            downloadedBytes: Number.isFinite(Number(task.downloadedBytes)) ? Number(task.downloadedBytes) : null,
            totalBytes: Number.isFinite(Number(task.totalBytes)) ? Number(task.totalBytes) : null,
            source: 'checkpoint',
        };
        let expectedTotalBytes = hasValidAuthoritativeTransfer(finalTransfer) ? Number(finalTransfer.totalBytes) : null;
        const active = {
            controller,
            task,
            taskId: task.id,
            execution: null,
            stopReason: null,
            processInfo: null,
            diagnostics: [],
            diagnosticPath: this.getDiagnosticPath(task.id),
        };
        const failureContext = {
            validated: null,
            args: null,
            folderBefore: null,
            diskBefore: null,
            capabilities,
            runtimeEnv,
        };
        this.active.set(task.id, active);
        const forward = (chunk) => {
            for (const event of parser.push(chunk)) {
                const progress = normalizeProgress(event, capabilities);
                progress.sessionId = sessionId || task.progressSessionId || null;
                const now = Date.now();
                if (isMeaningfulDownloadProgress(progress)) {
                    meaningfulProgressSeen = true;
                }
                if (hasValidAuthoritativeTransfer(progress)) {
                    if (expectedTotalBytes === null) {
                        expectedTotalBytes = Number(progress.totalBytes);
                        progress.expectedTotalBytes = expectedTotalBytes;
                    } else if (Number(progress.totalBytes) !== expectedTotalBytes) {
                        progress.unexpectedTotalBytes = Number(progress.totalBytes);
                        progress.expectedTotalBytes = expectedTotalBytes;
                        progress.totalBytes = expectedTotalBytes;
                        progress.providerTotalBytes = expectedTotalBytes;
                        if (Number(progress.downloadedBytes) > expectedTotalBytes) {
                            progress.downloadedBytes = expectedTotalBytes;
                            progress.providerDownloadedBytes = expectedTotalBytes;
                        }
                    }
                    finalTransfer = {
                        downloadedBytes: Number(progress.downloadedBytes),
                        totalBytes: Number(progress.totalBytes),
                        source: 'gogdl-overall-progress',
                    };
                }
                if (Number.isFinite(progress.progressPercent)) {
                    progress.progressPercent = progress.progressSource === 'gogdl-overall-progress'
                        ? progress.progressPercent
                        : Math.max(lastPercent, progress.progressPercent);
                    lastPercent = progress.progressPercent;
                }
                const statusChanged = progress.status && progress.status !== lastStatus;
                const important = progress.errorCode ||
                    statusChanged ||
                    progress.authoritativeTransfer === true ||
                    Number.isFinite(Number(progress.rawDownloadedBytes)) ||
                    Number.isFinite(Number(progress.rawDownloadSpeedBps)) ||
                    Number.isFinite(Number(progress.diskWriteSpeedBps)) ||
                    progress.progressPercent === 100;
                if (!important && now - lastProgressAt < 250) continue;
                lastProgressAt = now;
                if (progress.status) lastStatus = progress.status;
                onProgress(progress);
            }
        };
        try {
            const validated = this.validateTask(task);
            const args = this.buildDownloadArgs(validated, {
                forceGen: validated.verifiedBuildGeneration === 1 ? 1 : null,
            });
            failureContext.validated = validated;
            failureContext.args = args;
            failureContext.folderBefore = this.scanInstallSnapshot(validated.installPath);
            failureContext.diskBefore = this.measureFreeSpace(validated.installPath);
            onProgress({
                status: DOWNLOAD_STATUSES.DOWNLOADING,
                stage: 'downloading',
                statusMessage: 'Starting GOG download...',
                sessionId: sessionId || task.progressSessionId || null,
                providerProgressMode: 'unknown',
                runtimeVersion: capabilities.runtimeVersion || null,
            });
            await this.runDownloadAttempt({
                active,
                args,
                controller,
                forward,
                onProgress,
                capabilities,
                runtimeEnv,
                task,
                validated,
                forceGen: validated.verifiedBuildGeneration === 1 ? 1 : null,
            });
            for (const event of parser.flush()) {
                const progress = normalizeProgress(event, capabilities);
                progress.sessionId = sessionId || task.progressSessionId || null;
                if (isMeaningfulDownloadProgress(progress)) meaningfulProgressSeen = true;
                if (hasValidAuthoritativeTransfer(progress)) {
                    finalTransfer = {
                        downloadedBytes: Number(progress.downloadedBytes),
                        totalBytes: Number(progress.totalBytes),
                        source: 'gogdl-overall-progress',
                    };
                }
                onProgress(progress);
            }
            if (!meaningfulProgressSeen) {
                throw makeDownloadError('GOG_DOWNLOAD_NO_PROGRESS', safeMessage('GOG_DOWNLOAD_NO_PROGRESS'));
            }
            if (!isCompleteTransfer(finalTransfer)) {
                throw makeDownloadError('DOWNLOAD_INCOMPLETE_TRANSFER', safeMessage('DOWNLOAD_INCOMPLETE_TRANSFER'));
            }
            const verification = this.verifyInstalledGame(validated.installPath, {
                expectedBytes: finalTransfer.totalBytes,
            });
            if (verification.status !== 'passed') {
                throw makeDownloadError(
                    verification.diagnosticCode || 'DOWNLOAD_VERIFICATION_FAILED',
                    safeMessage(verification.diagnosticCode || 'DOWNLOAD_VERIFICATION_FAILED')
                );
            }
            return {
                provider: 'gog',
                processExitCode: 0,
                completionConfirmed: true,
                transfer: finalTransfer,
                verification,
                diagnosticCode: null,
                completedAt: new Date().toISOString(),
                runtimeVersion: capabilities.runtimeVersion || null,
            };
        } catch (err) {
            if (active.stopReason === 'startup-timeout') {
                this.writeDiagnostics(task, active, 'startup-timeout', {
                    normalizedErrorCode: 'GOG_DOWNLOAD_START_TIMEOUT',
                });
                throw makeDownloadError('GOG_DOWNLOAD_START_TIMEOUT', safeMessage('GOG_DOWNLOAD_START_TIMEOUT'));
            }
            if (controller.signal.aborted || err?.code === 'GOG_RUNTIME_CANCELLED') {
                if (active.stopReason === 'stall') {
                    this.writeDiagnostics(task, active, 'stall', {
                        normalizedErrorCode: 'GOG_DOWNLOAD_STALLED',
                    });
                }
                throw makeDownloadError('GOG_DOWNLOAD_CANCELLED', 'GOG download was stopped.');
            }
            if (err?.code && !['GOG_RUNTIME_PROCESS_FAILED', 'GOG_RUNTIME_MISSING', 'GOG_RUNTIME_INVALID'].includes(err.code)) {
                this.writeDiagnostics(task, active, 'failure', {
                    normalizedErrorCode: err.code,
                    technicalMessage: redactGogSecrets(err?.message || '').slice(0, 1000),
                });
                throw err;
            }
            const failure = this.diagnoseFailure(task, err, active, failureContext);
            const normalized = makeDownloadError(failure.code, failure.userMessage);
            normalized.failure = failure;
            normalized.retryable = failure.retryable;
            normalized.providerDiagnosticPath = active.diagnosticPath || null;
            this.writeDiagnostics(task, active, 'failure', {
                normalizedErrorCode: normalized?.code || null,
                technicalMessage: failure.technicalSummary,
                failure,
            });
            throw normalized;
        } finally {
            if (process.env.BADDEL_GOG_DOWNLOAD_DEBUG === '1') {
                this.writeDiagnostics(task, active, 'debug-final', {});
            }
            this.active.delete(task.id);
        }
    }

    diagnoseFailure(task, err, active, context = {}) {
        const validated = context.validated || {};
        return diagnoseGogDownloadFailure({
            task: {
                ...task,
                installDriveRoot: task.installDriveRoot || this.path.parse(validated.installPath || task.installPath || '').root || null,
            },
            err,
            diagnostics: active?.diagnostics || [],
            folderBefore: context.folderBefore || null,
            folderAfter: this.scanInstallSnapshot(validated.installPath || task.installPath),
            diskBefore: context.diskBefore || null,
            diskAfter: this.measureFreeSpace(validated.installPath || task.installPath),
            executionInfo: active?.processInfo || null,
            commandShape: context.args ? sanitizeArgs(context.args) : null,
            runtimeVersion: context.capabilities?.runtimeVersion || null,
        });
    }

    scanInstallSnapshot(installPath) {
        if (!installPath) return null;
        const snapshot = scanInstallDirectory({
            fsSync: this.fs,
            pathModule: this.path,
            installPath,
        });
        return {
            exists: snapshot.exists,
            actualBytes: snapshot.actualBytes,
            verifiedFileCount: snapshot.verifiedFileCount,
            executableFound: snapshot.executableFound,
            manifestFound: snapshot.manifestFound,
        };
    }

    measureFreeSpace(targetPath) {
        if (!targetPath || typeof this.fs.statfsSync !== 'function') return null;
        const candidates = [];
        try {
            candidates.push(this.fs.existsSync(targetPath) ? targetPath : this.path.dirname(targetPath));
            candidates.push(this.path.parse(targetPath).root);
        } catch {}
        for (const candidate of candidates.filter(Boolean)) {
            try {
                const stat = this.fs.statfsSync(candidate);
                const blockSize = Number(stat.bsize || stat.frsize || 0);
                const availableBlocks = Number(stat.bavail ?? stat.bfree);
                if (Number.isFinite(blockSize) && Number.isFinite(availableBlocks)) {
                    return {
                        path: candidate,
                        freeSpaceBytes: blockSize * availableBlocks,
                    };
                }
            } catch {}
        }
        return null;
    }

    async runDownloadAttempt({ active, args, controller, forward, onProgress, capabilities, runtimeEnv, task, validated, forceGen }) {
        const executionInfo = {
            pid: null,
            processStartedAt: null,
            firstOutputAt: null,
            fallbackDecision: forceGen ? 'force-gen-1-after-default-failure' : 'default-generation',
        };
        let startupTimer = null;
        let startupTimedOut = false;
        const markOutput = (chunk, stream) => {
            if (!executionInfo.firstOutputAt) {
                executionInfo.firstOutputAt = new Date().toISOString();
                if (startupTimer) {
                    clearTimeout(startupTimer);
                    startupTimer = null;
                }
            }
            this.recordDiagnosticLines(active, chunk, stream);
            forward(chunk);
        };
        try {
            this.logExecutionPlan({
                task,
                capabilities,
                operation: 'download',
                validated,
                forceGen,
                runtimeEnv,
                args,
                executionInfo,
            });
            startupTimer = setTimeout(() => {
                startupTimedOut = true;
                active.stopReason = 'startup-timeout';
                controller.abort();
            }, STARTUP_OUTPUT_TIMEOUT_MS);
            active.execution = this.runtime.spawnCommand(args, {
                env: runtimeEnv.env,
                signal: controller.signal,
                onStdout: chunk => markOutput(chunk, 'stdout'),
                onStderr: chunk => markOutput(chunk, 'stderr'),
                onStarted: ({ pid } = {}) => {
                    executionInfo.pid = pid || null;
                    executionInfo.processStartedAt = new Date().toISOString();
                    active.processInfo = { ...executionInfo };
                    onProgress({
                        status: DOWNLOAD_STATUSES.DOWNLOADING,
                        stage: 'downloading',
                        statusMessage: forceGen ? 'GOG compatibility download started.' : 'GOG download started.',
                        sessionId: task.progressSessionId || null,
                        processPid: pid || null,
                        processStartedAt: executionInfo.processStartedAt,
                        runtimeVersion: capabilities.runtimeVersion || null,
                    });
                },
            });
            await active.execution;
        } catch (err) {
            if (startupTimedOut) {
                const timeoutError = makeDownloadError('GOG_DOWNLOAD_START_TIMEOUT', safeMessage('GOG_DOWNLOAD_START_TIMEOUT'));
                this.logFailure({
                    task,
                    capabilities,
                    validated,
                    operation: 'download',
                    forceGen,
                    runtimeEnv,
                    normalized: timeoutError,
                    err,
                    args,
                    executionInfo,
                    fallbackDecision: executionInfo.fallbackDecision,
                });
                throw timeoutError;
            }
            this.logFailure({
                task,
                capabilities,
                validated,
                operation: 'download',
                forceGen,
                runtimeEnv,
                normalized: normalizeGogError(err),
                err,
                args,
                executionInfo,
                fallbackDecision: executionInfo.fallbackDecision,
            });
            throw err;
        } finally {
            active.processInfo = { ...executionInfo };
            if (startupTimer) clearTimeout(startupTimer);
        }
    }

    logExecutionPlan({ task, capabilities, operation, validated, forceGen, runtimeEnv, args = [], executionInfo = null }) {
        if (process.env.BADDEL_GOG_DOWNLOAD_DEBUG !== '1') return;
        console.debug('[GOGDownload] execution plan', {
            taskId: task?.id || null,
            command: 'gogdl.exe',
            operation,
            productId: validated?.productId || null,
            platform: this.platform,
            installPath: operation === 'download' ? validated?.installPath || null : null,
            args: sanitizeArgs(args),
            manifestMode: forceGen ? `force-gen-${forceGen}` : 'default',
            configPath: runtimeEnv?.configPath || null,
            authConfigPathPresent: Boolean(validated?.authPath),
            runtimeVersion: capabilities?.runtimeVersion || null,
            processPid: executionInfo?.pid || null,
            processStartedAt: executionInfo?.processStartedAt || null,
            firstOutputAt: executionInfo?.firstOutputAt || null,
        });
    }

    logFailure({ task, capabilities, validated, operation, forceGen, runtimeEnv, normalized, err, args = [], executionInfo = null, fallbackDecision = null }) {
        if (process.env.BADDEL_GOG_DOWNLOAD_DEBUG !== '1') return;
        console.warn('[GOGDownload] runtime failure', {
            taskId: task?.id || null,
            operation,
            productId: validated?.productId || null,
            platform: this.platform,
            args: sanitizeArgs(args),
            manifestMode: forceGen ? `force-gen-${forceGen}` : 'default',
            configPath: runtimeEnv?.configPath || null,
            runtimeVersion: capabilities?.runtimeVersion || null,
            processPid: executionInfo?.pid || null,
            processStartedAt: executionInfo?.processStartedAt || null,
            firstOutputAt: executionInfo?.firstOutputAt || null,
            normalizedErrorCode: normalized?.code || null,
            exitCode: err?.details?.code ?? err?.code ?? null,
            fallbackDecision,
            technicalMessage: redactGogSecrets(err?.message || '').slice(0, 1000),
        });
    }

    recordDiagnosticLines(active, chunk, stream = 'stdout') {
        if (!active?.diagnostics) return;
        const parser = new GogProgressParser();
        const text = String(chunk || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        for (const rawLine of text.split('\n')) {
            const line = redactGogSecrets(rawLine).trim();
            if (!line) continue;
            const parsed = parser.parseLine(line);
            active.diagnostics.push({
                at: new Date().toISOString(),
                stream,
                eventType: parsed?.eventType || 'unmatched',
                line: line.slice(0, 500),
            });
            if (active.diagnostics.length > DIAGNOSTIC_RING_LIMIT) {
                active.diagnostics.splice(0, active.diagnostics.length - DIAGNOSTIC_RING_LIMIT);
            }
        }
    }

    writeDiagnostics(task, active, reason, extra = {}) {
        if (!active?.diagnosticPath) return null;
        if (reason === 'debug-final' && process.env.BADDEL_GOG_DOWNLOAD_DEBUG !== '1') return null;
        try {
            this.fs.mkdirSync(this.getDiagnosticsDir(), { recursive: true });
            const payload = {
                version: 1,
                reason,
                taskId: task?.id || active.taskId || null,
                provider: 'gog',
                accountId: task?.accountId || null,
                providerProductId: task?.providerProductId || task?.contentSystemProductId || task?.gogdlAppName || null,
                installPath: task?.installPath || null,
                writtenAt: new Date().toISOString(),
                sampleLimit: DIAGNOSTIC_RING_LIMIT,
                diagnostics: Array.isArray(active.diagnostics) ? active.diagnostics.slice(-DIAGNOSTIC_RING_LIMIT) : [],
                ...extra,
            };
            this.fs.writeFileSync(active.diagnosticPath, JSON.stringify(payload, null, 2), 'utf8');
            return active.diagnosticPath;
        } catch {
            return null;
        }
    }

    async pause(taskId, options = {}) {
        const active = this.active.get(taskId);
        if (!active) return { requested: false, exitConfirmed: true, stoppedAt: new Date().toISOString() };
        active.stopReason = options.reason || 'pause';
        active.controller.abort();
        return waitForExecutionStop(active.execution, 5000, active.processInfo);
    }

    async cancel(taskId, options = {}) {
        const active = this.active.get(taskId);
        if (!active) return { requested: false, exitConfirmed: true, stoppedAt: new Date().toISOString() };
        active.stopReason = options.reason || 'cancel';
        active.controller.abort();
        const result = await waitForExecutionStop(active.execution, 5000, active.processInfo);
        if (active.stopReason === 'stall') {
            const diagnosticPath = this.writeDiagnostics(active.task, active, 'stall', {
                normalizedErrorCode: 'GOG_DOWNLOAD_STALLED',
            });
            if (diagnosticPath) result.diagnosticPath = diagnosticPath;
        }
        return result;
    }

    hasActive(taskId) {
        return this.active.has(taskId);
    }

    verifyInstalledGame(installPath, { expectedBytes = null } = {}) {
        const stats = scanInstallDirectory({
            fsSync: this.fs,
            pathModule: this.path,
            installPath,
        });
        const manifestFound = stats.manifestFound;
        const executableFound = stats.executableFound;
        if (!stats.exists || stats.verifiedFileCount <= 0 || stats.actualBytes <= 0) {
            return {
                status: 'failed',
                method: 'install-directory-scan',
                expectedFileCount: null,
                verifiedFileCount: stats.verifiedFileCount,
                expectedBytes,
                actualBytes: stats.actualBytes,
                executableFound,
                manifestFound,
                executablePath: stats.executablePath || null,
                diagnosticCode: 'DOWNLOAD_INSTALLATION_EMPTY',
            };
        }
        if (!executableFound && !manifestFound) {
            return {
                status: 'failed',
                method: 'install-directory-scan',
                expectedFileCount: null,
                verifiedFileCount: stats.verifiedFileCount,
                expectedBytes,
                actualBytes: stats.actualBytes,
                executableFound,
                manifestFound,
                executablePath: stats.executablePath || null,
                diagnosticCode: 'DOWNLOAD_VERIFICATION_FAILED',
            };
        }
        return {
            status: 'passed',
            method: manifestFound ? 'manifest-and-install-directory-scan' : 'install-directory-scan',
            expectedFileCount: null,
            verifiedFileCount: stats.verifiedFileCount,
            expectedBytes,
            actualBytes: stats.actualBytes,
            executableFound,
            manifestFound,
                executablePath: stats.executablePath || null,
        };
    }
}

function sanitizeArgs(args = []) {
    const sanitized = [];
    for (let index = 0; index < args.length; index += 1) {
        const arg = String(args[index] || '');
        sanitized.push(arg);
        if (arg === '--auth-config-path' && index + 1 < args.length) {
            sanitized.push('[AUTH_CONFIG_PATH]');
            index += 1;
        }
    }
    return sanitized.map(value => redactGogSecrets(value));
}

function normalizeGogProductId(value) {
    const id = String(value || '').replace(/^gog[-_]/i, '').trim();
    return /^\d+$/.test(id) ? id : null;
}

function redactGogSecrets(value) {
    return String(value || '').replace(SECRET_RE, (_m, key, sep) => `${key}${sep}[REDACTED]`);
}

function normalizeProgress(event = {}, capabilities = {}) {
    const next = {
        stage: event.stage || event.phase || 'downloading',
        statusMessage: friendlyProgressMessage(event),
        runtimeVersion: capabilities.runtimeVersion || null,
    };
    if (event.stage === 'verifying') next.status = DOWNLOAD_STATUSES.VERIFYING;
    else if (event.stage === 'installing') next.status = DOWNLOAD_STATUSES.INSTALLING;
    else next.status = DOWNLOAD_STATUSES.DOWNLOADING;
    if (Number.isFinite(Number(event.progressPercent))) next.progressPercent = Number(event.progressPercent);
    next.eventType = event.eventType || null;
    next.authoritativeTransfer = event.authoritativeTransfer === true;
    if (event.progressSource) next.progressSource = String(event.progressSource);
    if (Number.isFinite(Number(event.writtenBytes))) next.writtenBytes = Number(event.writtenBytes);
    if (Number.isFinite(Number(event.rawDownloadedBytes))) next.rawDownloadedBytes = Number(event.rawDownloadedBytes);
    if (Number.isFinite(Number(event.rawDownloadSpeedBps))) next.rawDownloadSpeedBps = Number(event.rawDownloadSpeedBps);
    if (Number.isFinite(Number(event.decompressionSpeedBps))) next.decompressionSpeedBps = Number(event.decompressionSpeedBps);
    if (Number.isFinite(Number(event.diskWriteSpeedBps))) next.diskWriteSpeedBps = Number(event.diskWriteSpeedBps);
    if (Number.isFinite(Number(event.diskReadSpeedBps))) next.diskReadSpeedBps = Number(event.diskReadSpeedBps);
    if (event.authoritativeTransfer === true && Number.isFinite(Number(event.downloadedBytes))) next.downloadedBytes = Number(event.downloadedBytes);
    if (event.authoritativeTransfer === true && Number.isFinite(Number(event.totalBytes))) next.totalBytes = Number(event.totalBytes);
    if (
        event.authoritativeTransfer === true &&
        event.providerProgressMode === 'absolute' &&
        event.progressSource === 'gogdl-overall-progress' &&
        Number.isFinite(Number(event.downloadedBytes)) &&
        Number.isFinite(Number(event.totalBytes))
    ) {
        next.providerProgressMode = 'absolute';
        next.providerDownloadedBytes = Number(event.downloadedBytes);
        next.providerTotalBytes = Number(event.totalBytes);
        next.downloadedBytesSource = 'gogdl-overall-progress';
        next.totalBytesSource = 'gogdl-overall-progress';
    } else {
        next.providerProgressMode = 'unknown';
    }
    if (Number.isFinite(Number(event.rawDownloadSpeedBps))) next.downloadSpeedBps = Number(event.rawDownloadSpeedBps);
    else if (Number.isFinite(Number(event.downloadSpeedBps))) next.downloadSpeedBps = Number(event.downloadSpeedBps);
    if (Number.isFinite(Number(event.diskWriteSpeedBps))) next.diskUsageBps = Number(event.diskWriteSpeedBps);
    else if (Number.isFinite(Number(event.diskUsageBps))) next.diskUsageBps = Number(event.diskUsageBps);
    if (Number.isFinite(Number(event.etaSeconds))) next.etaSeconds = Number(event.etaSeconds);
    if (event.errorCode) next.errorCode = event.errorCode;
    return next;
}

function isMeaningfulDownloadProgress(progress = {}) {
    const downloadedBytes = Number(progress.downloadedBytes);
    return (
        progress.authoritativeTransfer === true &&
        progress.providerProgressMode === 'absolute' &&
        progress.progressSource === 'gogdl-overall-progress' &&
        Number.isFinite(downloadedBytes) &&
        downloadedBytes > 0
    );
}

function hasValidAuthoritativeTransfer(progress = {}) {
    const downloadedBytes = Number(progress.downloadedBytes);
    const totalBytes = Number(progress.totalBytes);
    return (
        progress.authoritativeTransfer === true &&
        progress.providerProgressMode === 'absolute' &&
        progress.progressSource === 'gogdl-overall-progress' &&
        Number.isFinite(downloadedBytes) &&
        Number.isFinite(totalBytes) &&
        downloadedBytes >= 0 &&
        totalBytes > 0 &&
        downloadedBytes <= totalBytes
    );
}

function hasValidAbsoluteTransfer(progress = {}) {
    return hasValidAuthoritativeTransfer(progress);
}

function isCompleteTransfer(transfer = {}) {
    const downloadedBytes = Number(transfer.downloadedBytes);
    const totalBytes = Number(transfer.totalBytes);
    return (
        Number.isFinite(downloadedBytes) &&
        Number.isFinite(totalBytes) &&
        totalBytes > 0 &&
        downloadedBytes >= totalBytes
    );
}

function scanInstallDirectory({ fsSync, pathModule, installPath }) {
    const result = {
        exists: false,
        actualBytes: 0,
        verifiedFileCount: 0,
        executableFound: false,
        manifestFound: false,
    };
    try {
        if (!installPath || !fsSync.existsSync(installPath) || !fsSync.statSync(installPath).isDirectory()) {
            return result;
        }
        result.exists = true;
        const walk = (dir) => {
            for (const entry of fsSync.readdirSync(dir, { withFileTypes: true })) {
                const full = pathModule.join(dir, entry.name);
                const rel = pathModule.relative(installPath, full).replace(/\\/g, '/').toLowerCase();
                if (entry.isDirectory()) {
                    if (rel === '.baddel-gog-support' || rel.startsWith('.baddel-gog-support/')) continue;
                    if (rel === '__support' || rel.startsWith('__support/')) continue;
                    walk(full);
                    continue;
                }
                if (!entry.isFile()) continue;
                if (rel === '.baddel-download-partial.json') continue;
                if (rel.startsWith('.baddel-gog-support/')) continue;
                if (rel.startsWith('__support/')) continue;
                const stat = fsSync.statSync(full);
                result.actualBytes += stat.size;
                result.verifiedFileCount += 1;
                if (/\.(exe|bat|cmd)$/i.test(entry.name)) {
                    result.executableFound = true;
                    if (!result.executablePath) result.executablePath = full;
                }
                if (/manifest|goggame|gameinfo|\.gog/i.test(entry.name) || rel.includes('/manifest')) {
                    result.manifestFound = true;
                }
            }
        };
        walk(installPath);
    } catch {
        return result;
    }
    return result;
}

function friendlyProgressMessage(event = {}) {
    const stage = event.stage || event.phase || 'downloading';
    const eta = Number(event.etaSeconds);

    const etaText = Number.isFinite(eta) && eta > 0
        ? ` · ${formatDuration(eta)} left`
        : '';

    if (stage === 'verifying') {
        return `Verifying files${etaText}`;
    }

    if (stage === 'installing') {
        return 'Finishing installation';
    }

    if (stage === 'preparing') {
        return 'Preparing download';
    }

    return `Downloading${etaText}`;
}

function formatDuration(seconds) {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${secs}s`;
    return `${secs}s`;
}

async function waitForExecutionStop(execution, timeoutMs, processInfo = null) {
    const base = {
        requested: true,
        pid: processInfo?.pid || null,
        exitConfirmed: true,
        exitCode: null,
        signal: null,
        timedOut: false,
        forced: true,
        stoppedAt: new Date().toISOString(),
    };
    if (!execution) return base;
    let timedOut = false;
    await Promise.race([
        execution.catch((err) => {
            base.exitCode = err?.details?.code ?? null;
            base.signal = err?.details?.signal ?? null;
        }),
        new Promise(resolve => setTimeout(() => {
            timedOut = true;
            resolve();
        }, timeoutMs)),
    ]);
    if (timedOut) {
        base.exitConfirmed = false;
        base.timedOut = true;
    }
    base.stoppedAt = new Date().toISOString();
    return base;
}

function classifyGogError(err) {
    const raw = String(err?.message || '').toLowerCase();
    if (/\[generic_download_manager\]\s+info:/.test(raw) && !/\berror\b|\bfailed\b|traceback|exception/.test(raw)) {
        return { kind: 'startup_no_progress', retryable: true, forceGenerationFallbackAllowed: false };
    }
    if (/auth|token|unauthorized|forbidden/.test(raw)) {
        return { kind: 'auth', retryable: false, forceGenerationFallbackAllowed: false };
    }
    if (/not owned|ownership|license/.test(raw)) {
        return { kind: 'ownership', retryable: false, forceGenerationFallbackAllowed: false };
    }
    if (/space|disk full|no space/.test(raw)) {
        return { kind: 'disk_space', retryable: false, forceGenerationFallbackAllowed: false };
    }
    if (/network|timeout|connection|temporar/.test(raw)) {
        return { kind: 'network', retryable: false, forceGenerationFallbackAllowed: false };
    }
    if (/no compatible (windows )?(build|manifest)s?|windows build (was )?not found|build resolution failed|no builds? found/.test(raw)) {
        return { kind: 'build_unavailable', retryable: true, forceGenerationFallbackAllowed: true };
    }
    if (
        /does(?:n't| not) support content system api/.test(raw) ||
        /content system generation (?:is )?unsupported/.test(raw) ||
        /manifest (?:or )?build data unavailable/.test(raw) ||
        /manifest resolution failed/.test(raw) ||
        /unsupported content generation mode/.test(raw)
    ) {
        return { kind: 'manifest_resolution', retryable: true, forceGenerationFallbackAllowed: true };
    }
    return { kind: 'process', retryable: false, forceGenerationFallbackAllowed: false };
}

function normalizeGogError(err) {
    if (err?.code && String(err.code).startsWith('GOG_') && err.code !== 'GOG_RUNTIME_PROCESS_FAILED') {
        return err;
    }
    const codeMap = {
        GOG_RUNTIME_MISSING: 'GOG_RUNTIME_NOT_FOUND',
        GOG_RUNTIME_INVALID: 'GOG_RUNTIME_INTEGRITY_FAILED',
        GOG_RUNTIME_PROCESS_FAILED: 'GOG_DOWNLOAD_PROCESS_FAILED',
    };
    const raw = redactGogSecrets(String(err?.message || ''));
    let code = codeMap[err?.code] || err?.code || 'GOG_DOWNLOAD_PROCESS_FAILED';
    const classification = classifyGogError(err);
    if (classification.kind === 'auth') code = 'GOG_AUTH_REQUIRED';
    else if (classification.kind === 'ownership') code = 'GOG_GAME_NOT_OWNED';
    else if (classification.kind === 'disk_space') code = 'DOWNLOAD_INSUFFICIENT_DISK_SPACE';
    else if (classification.kind === 'network') code = 'GOG_NETWORK_ERROR';
    else if (classification.kind === 'startup_no_progress') code = 'GOG_DOWNLOAD_NO_PROGRESS';
    else if (classification.kind === 'build_unavailable') code = 'GOG_BUILD_NOT_AVAILABLE';
    else if (classification.kind === 'manifest_resolution') code = 'GOG_MANIFEST_RESOLUTION_FAILED';
    return makeDownloadError(code, safeMessage(code, raw));
}

function safeMessage(code, raw = '') {
    if (code === 'GOG_AUTH_REQUIRED') return 'GOG authentication expired. Relink the GOG account and retry.';
    if (code === 'GOG_GAME_NOT_OWNED') return 'The selected GOG account does not own this game.';
    if (code === 'GOG_INVALID_PRODUCT_ID') return 'Baddel could not identify this game on GOG. Sync the GOG library again.';
    if (code === 'GOG_PRODUCT_ID_MISSING') return 'This game is missing its GOG download identity. Sync the GOG library again and retry.';
    if (code === 'GOG_OWNED_IDENTITY_UNRESOLVED') return 'Baddel could not resolve a verified GOG download identity for this game.';
    if (code === 'GOG_OWNED_IDENTITY_AMBIGUOUS') return 'Baddel found more than one licensed GOG download identity for this game.';
    if (code === 'GOG_INVALID_LICENCE') return 'Baddel found this GOG game, but could not verify a downloadable licence for the connected account. Refresh or reconnect the GOG account and try again.';
    if (code === 'GOG_SECURE_LINK_REJECTED') return 'GOG rejected the download licence check. Reconnect the GOG account and try again.';
    if (code === 'GOG_SECURE_LINK_TIMEOUT') return 'GOG licence verification timed out. Check the connection and try again.';
    if (code === 'GOG_WINDOWS_BUILD_NOT_AVAILABLE') return 'No downloadable Windows build was found for this GOG game.';
    if (code === 'GOG_BUILD_NOT_AVAILABLE') return 'No downloadable Windows build was found for this GOG game.';
    if (code === 'GOG_MANIFEST_RESOLUTION_FAILED') return 'Baddel could not resolve the GOG download manifest. Retry or relink the account.';
    if (code === 'GOG_DOWNLOAD_START_TIMEOUT') return 'The GOG download did not start in time. Check the connection or relink the account.';
    if (code === 'GOG_DOWNLOAD_NO_PROGRESS') return 'GOG opened the download manager but stopped before transferring files. Retry the download, or choose a new empty install folder.';
    if (code === 'DOWNLOAD_INCOMPLETE_TRANSFER') return 'The download stopped before the full game was transferred. Retry the download.';
    if (code === 'DOWNLOAD_VERIFICATION_FAILED') return 'Baddel could not verify the downloaded game files. Retry or choose a new folder.';
    if (code === 'DOWNLOAD_INSTALLATION_EMPTY') return 'The install folder does not contain a completed game installation.';
    if (code === 'DOWNLOAD_EXPECTED_SIZE_MISMATCH') return 'The downloaded size did not match the expected game size.';
    if (code === 'DOWNLOAD_INSUFFICIENT_DISK_SPACE' || code === 'GOG_INSUFFICIENT_DISK_SPACE') return 'There is not enough free disk space for this download.';
    if (code === 'GOG_NETWORK_ERROR') return 'GOG download hit a network error. Retry when the connection is stable.';
    if (code === 'GOG_RUNTIME_NOT_FOUND') return 'The bundled GOG downloader is missing.';
    if (code === 'GOG_RUNTIME_INTEGRITY_FAILED') return 'The bundled GOG downloader failed verification.';
    if (raw) return redactGogSecrets(raw).slice(0, 240);
    return 'The GOG download process failed. Check the technical log for details.';
}

module.exports = {
    GogDownloadAdapter,
    normalizeGogError,
    classifyGogError,
    normalizeGogProductId,
    redactGogSecrets,
    DIAGNOSTIC_RING_LIMIT,
};

