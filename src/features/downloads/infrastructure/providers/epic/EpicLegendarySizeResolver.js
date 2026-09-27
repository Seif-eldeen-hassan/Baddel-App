'use strict';

const fs = require('fs');
const path = require('path');
const ini = require('ini');
const { legendaryFailureCode } = require('./EpicLegendaryRuntimeService');

const positiveBytes = value => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
const unavailable = sizeReason => ({ downloadSizeBytes: null, installedDiskSizeBytes: null, sizeReason });
const publicText = value => typeof value === 'string' ? value.replace(/[\x00-\x1f]/g, '').slice(0, 160) : null;

function selectionKey(task, resolved, tags) {
    return JSON.stringify([resolved.account.id, resolved.appName, task.targetPlatform || 'Windows', task.language || null,
        task.sdlPolicy || 'skip-sdl', task.installTags || null, tags,
        task.dlcPolicy || 'skip-dlcs', task.buildId || null, task.buildVersion || null]);
}

function parseLegendaryInfo(info, appName, task = {}, configTags = null) {
    if (!info || typeof info !== 'object' || info.game?.app_name !== appName) return unavailable('EPIC_INFO_IDENTITY_MISMATCH');
    if (info.game.is_dlc === true || (task.targetPlatform && task.targetPlatform !== 'Windows') ||
        (task.sdlPolicy && task.sdlPolicy !== 'skip-sdl') || (task.dlcPolicy && task.dlcPolicy !== 'skip-dlcs') ||
        task.installTags?.length) return unavailable('EPIC_SELECTION_SIZE_AMBIGUOUS');
    const manifest = info.manifest;
    if (!manifest) return unavailable('EPIC_MANIFEST_UNAVAILABLE');
    const downloadSizeBytes = positiveBytes(manifest.download_size);
    const installedDiskSizeBytes = positiveBytes(manifest.disk_size);
    if (!downloadSizeBytes || !installedDiskSizeBytes || !Array.isArray(manifest.install_tags) ||
        !manifest.install_tags.every(tag => typeof tag === 'string')) return unavailable('EPIC_MANIFEST_SCHEMA_UNSUPPORTED');
    if (manifest.install_tags.some(Boolean) || configTags?.some(Boolean)) return unavailable('EPIC_SELECTION_SIZE_AMBIGUOUS');
    const windowsVersion = info.game.platform_versions?.Windows;
    if (!windowsVersion || windowsVersion !== manifest.build_version) return unavailable('EPIC_MANIFEST_VERSION_MISMATCH');
    return { downloadSizeBytes, installedDiskSizeBytes, sizeReason: null,
        sizeSource: 'legendary-info-manifest', downloadSizeSource: 'legendary-info-manifest', installedSizeSource: 'legendary-info-manifest',
        buildVersion: publicText(manifest.build_version), buildId: publicText(manifest.build_id) };
}

class EpicLegendarySizeResolver {
    constructor({ runtimeService, accountResolver, diagnostics = null, cacheRepository = null, fsSync = fs, now = Date.now,
        timeoutMs = 45000, cacheTtlMs = 24 * 60 * 60 * 1000, maxOutputBytes = 2 * 1024 * 1024 } = {}) {
        this.runtime = runtimeService; this.accounts = accountResolver; this.fs = fsSync;
        this.now = now; this.diagnostics = diagnostics; this.cacheRepository = cacheRepository;
        this.timeoutMs = timeoutMs; this.cacheTtlMs = cacheTtlMs; this.maxOutputBytes = maxOutputBytes;
        this.cache = new Map(); this.pending = new Map();
    }

    readTags(configPath, appName) {
        const file = path.join(configPath, 'config.ini');
        try {
            if (this.fs.statSync(file).size > 256 * 1024) throw new Error('Config too large');
            const config = ini.parse(this.fs.readFileSync(file, 'utf8'));
            const tags = config[appName]?.install_tags ?? config.DEFAULT?.install_tags;
            return tags == null ? null : String(tags).split(',').map(tag => tag.trim());
        } catch (error) {
            if (error.code === 'ENOENT') return null;
            throw Object.assign(new Error('Selection settings unavailable'), { code: 'EPIC_SELECTION_SIZE_AMBIGUOUS' });
        }
    }

    async resolve(task = {}) {
        const trace = (stage, value = {}) => this.diagnostics?.record?.(task.installPlanCorrelationId, stage, value);
        const resolverStartedAt = this.now();
        if (task.platform !== 'epic' || task.installProvider !== 'legendary') return unavailable('EPIC_SIZE_PROVIDER_UNSUPPORTED');
        let resolved, tags;
        try {
            const accountStartedAt = this.now();
            resolved = await this.accounts.validateTask(task);
            trace('EPIC_SIZE_ACCOUNT_RESOLUTION', { accountId: resolved.account?.id || task.accountId || null, ownershipResult: 'owned', configResolved: Boolean(resolved.configPath), durationMs: this.now() - accountStartedAt });
            trace('EPIC_SIZE_APP_IDENTITY', { gameId: task.gameId || null, canonicalGameId: task.canonicalGameId || null, providerAppName: task.providerAppName || null, providerProductId: task.providerProductId || null, namespace: task.namespace || null, catalogItemId: task.catalogItemId || null, resolvedAppName: resolved.appName || null });
            const tagsStartedAt = this.now();
            tags = this.readTags(resolved.configPath, resolved.appName);
            trace('EPIC_SIZE_CONFIG_TAGS', { durationMs: this.now() - tagsStartedAt, configuredTagCount: Array.isArray(tags) ? tags.filter(Boolean).length : 0 });
        } catch (error) {
            const allowed = ['EPIC_AUTH_REQUIRED', 'EPIC_GAME_NOT_OWNED', 'EPIC_SELECTION_SIZE_AMBIGUOUS', 'EPIC_ACCOUNT_NOT_LINKED', 'EPIC_APP_NAME_UNRESOLVED'];
            const reason = allowed.includes(error.code) ? error.code : 'EPIC_INFO_UNAVAILABLE';
            trace('EPIC_SIZE_ACCOUNT_RESOLUTION', { accountId: task.accountId || null, ownershipResult: 'failed', sizeReason: reason, totalResolverDurationMs: this.now() - resolverStartedAt });
            return unavailable(reason);
        }
        const key = selectionKey(task, resolved, tags);
        const persistentKey = 'epic:' + key;
        const cached = this.cache.get(key);
        if (cached && cached.expiresAt > this.now()) {
            trace('EPIC_SIZE_CACHE_LOOKUP', { layer: 'memory', cacheHit: true, totalResolverDurationMs: this.now() - resolverStartedAt });
            return { ...cached.value };
        }
        const persisted = this.cacheRepository?.get?.(persistentKey) || null;
        if (persisted) {
            this.cache.set(key, { value: persisted, expiresAt: this.now() + this.cacheTtlMs });
            trace('EPIC_SIZE_CACHE_LOOKUP', { layer: 'persistent', cacheHit: true, totalResolverDurationMs: this.now() - resolverStartedAt });
            return { ...persisted };
        }
        trace('EPIC_SIZE_CACHE_LOOKUP', { layer: 'memory+persistent', cacheHit: false });
        if (this.pending.has(key)) {
            trace('EPIC_SIZE_PENDING_REQUEST', { coalesced: true });
            return this.pending.get(key);
        }
        trace('EPIC_SIZE_PENDING_REQUEST', { coalesced: false });
        const request = this.probe(resolved, task, 1, this.timeoutMs).then(result => {
            const parsed = result.sizeReason ? result : parseLegendaryInfo(result.info, resolved.appName, task, tags);
            trace('EPIC_INFO_MANIFEST_RESULT', { sizeReason: parsed.sizeReason || null, gameObjectPresent: Boolean(result.info?.game), manifestObjectPresent: Boolean(result.info?.manifest), downloadSizeBytes: parsed.downloadSizeBytes || null, installedDiskSizeBytes: parsed.installedDiskSizeBytes || null, buildVersion: parsed.buildVersion || null });
            return parsed;
        }).then(async value => {
            if (!value.sizeReason) {
                if (this.cache.size >= 50) this.cache.clear();
                this.cache.set(key, { value, expiresAt: this.now() + this.cacheTtlMs });
                const persisted = await this.cacheRepository?.set?.(persistentKey, value).catch(() => false);
                trace('EPIC_SIZE_CACHE_WRITE', { layer: 'memory+persistent', completed: persisted === true });
            }
            trace('EPIC_SIZE_RESOLVER_COMPLETE', { totalResolverDurationMs: this.now() - resolverStartedAt, sizeReason: value.sizeReason || null });
            return { ...value };
        }).finally(() => this.pending.delete(key));
        this.pending.set(key, request);
        return request;
    }

    probe(resolved, task = {}, attempt = 1, timeoutMs = this.timeoutMs) {
        return new Promise(resolve => {
            let child, timer, settled = false, bytes = 0, firstStdoutAt = null;
            const stdout = [], stderr = [];
            const startedAt = this.now();
            const trace = (stage, value = {}) => this.diagnostics?.record?.(task.installPlanCorrelationId, stage, value);
            const finish = value => { if (settled) return; settled = true; clearTimeout(timer); resolve(value); };
            const stop = reason => {
                try { this.runtime.terminateProcess(child); } catch { child?.kill?.(); }
                trace('EPIC_INFO_PROCESS_TERMINATED', { attempt, reason, elapsedMs: this.now() - startedAt });
                finish(unavailable(reason));
            };
            try {
                const args = ['info', resolved.appName, '--json', '--platform', 'Windows'];
                trace('EPIC_INFO_PROCESS_START', { command: 'legendary info', arguments: args, resolvedAppName: resolved.appName, timeoutMs, attempt });
                const createStartedAt = this.now();
                child = this.runtime.createProcess(args, resolved.configPath);
                trace('EPIC_INFO_PROCESS_CREATED', { attempt, processCreationMs: this.now() - createStartedAt });
            } catch { finish(unavailable('EPIC_INFO_UNAVAILABLE')); return; }
            const collect = (buffer, chunk, stream) => {
                if (settled) return;
                if (stream === 'stdout' && firstStdoutAt === null) {
                    firstStdoutAt = this.now();
                    trace('EPIC_INFO_FIRST_STDOUT', { attempt, elapsedMs: firstStdoutAt - startedAt });
                }
                bytes += Buffer.byteLength(chunk);
                if (bytes > this.maxOutputBytes) { stop('EPIC_INFO_OUTPUT_TOO_LARGE'); return; }
                buffer.push(Buffer.from(chunk));
            };
            child.stdout?.on('data', chunk => collect(stdout, chunk, 'stdout'));
            child.stderr?.on('data', chunk => collect(stderr, chunk, 'stderr'));
            child.once('error', error => {
                trace('EPIC_INFO_PROCESS_EXIT', { attempt, exitCode: null, elapsedMs: this.now() - startedAt, stdoutBytes: Buffer.concat(stdout).length, stderrBytes: Buffer.concat(stderr).length, sizeReason: 'EPIC_INFO_UNAVAILABLE', errorName: String(error?.name || 'Error').slice(0, 80) });
                finish(unavailable('EPIC_INFO_UNAVAILABLE'));
            });
            child.once('close', code => {
                if (settled) return;
                const stdoutBuffer = Buffer.concat(stdout); const stderrBuffer = Buffer.concat(stderr);
                const errorText = stderrBuffer.toString('utf8');
                trace('EPIC_INFO_PROCESS_EXIT', { attempt, exitCode: code, elapsedMs: this.now() - startedAt, firstStdoutMs: firstStdoutAt === null ? null : firstStdoutAt - startedAt, stdoutBytes: stdoutBuffer.length, stderrBytes: stderrBuffer.length });
                const failure = /log\s*in failed/i.test(errorText) ? 'EPIC_AUTH_REQUIRED' : legendaryFailureCode(errorText);
                if (code !== 0 || failure) { finish(unavailable(['EPIC_AUTH_REQUIRED', 'EPIC_GAME_NOT_OWNED'].includes(failure) ? failure : 'EPIC_INFO_UNAVAILABLE')); return; }
                const parseStartedAt = this.now();
                try {
                    const parsed = JSON.parse(stdoutBuffer.toString('utf8'));
                    trace('EPIC_INFO_JSON_PARSE', { attempt, success: true, durationMs: this.now() - parseStartedAt, gameObjectPresent: Boolean(parsed?.game), manifestObjectPresent: Boolean(parsed?.manifest) });
                    finish({ info: parsed });
                } catch {
                    trace('EPIC_INFO_JSON_PARSE', { attempt, success: false, durationMs: this.now() - parseStartedAt, sizeReason: 'EPIC_INFO_JSON_INVALID' });
                    finish(unavailable('EPIC_INFO_JSON_INVALID'));
                }
            });
            timer = setTimeout(() => {
                trace('EPIC_INFO_TIMEOUT', { attempt, elapsedMs: this.now() - startedAt, stdoutBytes: Buffer.concat(stdout).length, stderrBytes: Buffer.concat(stderr).length, timeoutMs, sizeReason: 'EPIC_INFO_TIMEOUT', retryScheduled: false });
                stop('EPIC_INFO_TIMEOUT');
            }, timeoutMs);
        });
    }
}

module.exports = { EpicLegendarySizeResolver, parseLegendaryInfo, selectionKey };
