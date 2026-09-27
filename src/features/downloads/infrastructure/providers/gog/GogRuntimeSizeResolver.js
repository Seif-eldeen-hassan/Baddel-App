'use strict';

const fs = require('fs');
const path = require('path');

function numericId(value) { const normalized = String(value || '').replace(/^gog[-_]/i, '').trim(); return /^\d+$/.test(normalized) ? normalized : null; }
function positive(value) { const number = Number(value); return Number.isSafeInteger(number) && number > 0 ? number : null; }
function resolveOwnedProductId(payload = {}) {
    const identity = payload.gogIdentity && typeof payload.gogIdentity === 'object' ? payload.gogIdentity : {};
    const accountId = String(payload.accountId || '');
    const owners = Array.isArray(payload.ownedByAccountIds) ? payload.ownedByAccountIds.map(String) : [];
    if (owners.length && !owners.includes(accountId)) return { productId: null, sizeReason: 'GOG_GAME_NOT_OWNED' };
    const productId = [payload.contentSystemProductId, payload.gogdlAppName, payload.gogProductId, payload.providerProductId,
        payload.providerAppName, identity.contentSystemProductId, identity.gogdlAppName, identity.gogProductId,
        identity.gamesDbExternalId, identity.galaxyExternalId, payload.productId, payload.appName, payload.allIds?.gog]
        .map(numericId).find(Boolean);
    return productId ? { productId, sizeReason: null } : { productId: null, sizeReason: 'GOG_OWNED_IDENTITY_UNRESOLVED' };
}
function parseInfoJson(stdout) {
    const lines = String(stdout || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    for (let index = lines.length - 1; index >= 0; index -= 1) { if (!lines[index].startsWith('{')) continue; try { return JSON.parse(lines[index]); } catch {} }
    return null;
}
function selectedLanguageSize(info, language) {
    const common = info?.size?.['*'] || {}; const localized = info?.size?.[language] || null;
    if (!localized) return null;
    const download = positive(Number(common.download_size || 0) + Number(localized.download_size || 0));
    const installed = positive(Number(common.disk_size || 0) + Number(localized.disk_size || 0));
    return download && installed ? { download, installed } : null;
}
function gogSizeKey(payload, productId, language) {
    return JSON.stringify([payload.accountId, productId, 'windows', language, 'skip-dlcs', payload.buildId || null, payload.buildVersion || null]);
}

class GogRuntimeSizeResolver {
    constructor({ runtime, userDataDir, timeoutMs = 45000, cacheTtlMs = 24 * 60 * 60 * 1000, fsSync = fs, pathModule = path, diagnostics = null, cacheRepository = null, now = Date.now } = {}) {
        if (!runtime) throw new Error('GogRuntimeSizeResolver requires runtime');
        if (!userDataDir) throw new Error('GogRuntimeSizeResolver requires userDataDir');
        this.runtime = runtime; this.userDataDir = userDataDir; this.timeoutMs = timeoutMs; this.cacheTtlMs = cacheTtlMs;
        this.fs = fsSync; this.path = pathModule; this.diagnostics = diagnostics; this.cacheRepository = cacheRepository; this.now = now;
        this.cache = new Map(); this.pending = new Map();
    }
    async resolve(payload = {}) {
        const startedAt = this.now();
        const trace = (stage, value = {}) => this.diagnostics?.record?.(payload.installPlanCorrelationId, stage, value);
        const identity = resolveOwnedProductId(payload);
        trace('GOG_SIZE_IDENTITY', { productId: identity.productId, accountId: payload.accountId || null, sizeReason: identity.sizeReason });
        if (!identity.productId) return { sizeReason: identity.sizeReason };
        if (!payload.accountId) return { sizeReason: 'GOG_ACCOUNT_NOT_FOUND' };
        const authStartedAt = this.now();
        const authPath = this.path.join(this.userDataDir, 'gog', 'accounts', String(payload.accountId), 'auth.json');
        const authPresent = this.fs.existsSync(authPath);
        trace('GOG_SIZE_AUTH_VALIDATION', { accountId: payload.accountId, authPresent, durationMs: this.now() - authStartedAt });
        if (!authPresent) return { sizeReason: 'GOG_AUTH_REQUIRED' };
        const language = String(payload.language || 'en-US');
        const key = gogSizeKey(payload, identity.productId, language); const persistentKey = 'gog:' + key;
        const memory = this.cache.get(key);
        if (memory && memory.expiresAt > this.now()) { trace('GOG_SIZE_CACHE_LOOKUP', { layer: 'memory', cacheHit: true, totalResolverDurationMs: this.now() - startedAt }); return { ...memory.value }; }
        const persisted = this.cacheRepository?.get?.(persistentKey) || null;
        if (persisted) { this.cache.set(key, { value: persisted, expiresAt: this.now() + this.cacheTtlMs }); trace('GOG_SIZE_CACHE_LOOKUP', { layer: 'persistent', cacheHit: true, totalResolverDurationMs: this.now() - startedAt }); return { ...persisted }; }
        trace('GOG_SIZE_CACHE_LOOKUP', { layer: 'memory+persistent', cacheHit: false });
        if (this.pending.has(key)) { trace('GOG_SIZE_PENDING_REQUEST', { coalesced: true }); return this.pending.get(key); }
        trace('GOG_SIZE_PENDING_REQUEST', { coalesced: false });
        const request = this.probe(payload, identity.productId, language, authPath, startedAt).then(async value => {
            if (!value.sizeReason) {
                this.cache.set(key, { value, expiresAt: this.now() + this.cacheTtlMs });
                const persisted = await this.cacheRepository?.set?.(persistentKey, value).catch(() => false);
                trace('GOG_SIZE_CACHE_WRITE', { layer: 'memory+persistent', completed: persisted === true });
            }
            trace('GOG_SIZE_RESOLVER_COMPLETE', { totalResolverDurationMs: this.now() - startedAt, sizeReason: value.sizeReason || null });
            return { ...value };
        }).finally(() => this.pending.delete(key));
        this.pending.set(key, request); return request;
    }
    async probe(payload, productId, language, authPath, resolverStartedAt) {
        const trace = (stage, value = {}) => this.diagnostics?.record?.(payload.installPlanCorrelationId, stage, value);
        const args = ['--auth-config-path', authPath, 'info', productId, '--platform', 'windows', '--lang', language, '--skip-dlcs'];
        const processStartedAt = this.now(); let firstStdoutAt = null;
        trace('GOG_INFO_PROCESS_START', { command: 'gogdl info', productId, language, timeoutMs: this.timeoutMs });
        let result;
        try {
            result = await this.runtime.run(args, { timeoutMs: this.timeoutMs, redactOutput: true,
                onStarted: () => trace('GOG_INFO_PROCESS_CREATED', { processCreationMs: this.now() - processStartedAt }),
                onStdout: () => { if (firstStdoutAt === null) { firstStdoutAt = this.now(); trace('GOG_INFO_FIRST_STDOUT', { elapsedMs: firstStdoutAt - processStartedAt }); } },
            });
        } catch (error) {
            const code = error?.code === 'GOG_RUNTIME_CANCELLED' ? 'GOG_INFO_TIMEOUT' : /^GOG_[A-Z0-9_]+$/.test(String(error?.code || '')) ? error.code : 'GOG_INFO_UNAVAILABLE';
            trace('GOG_INFO_PROCESS_ERROR', { sizeReason: code, elapsedMs: this.now() - processStartedAt }); return { sizeReason: code };
        }
        trace('GOG_INFO_PROCESS_EXIT', { exitCode: result.code, elapsedMs: this.now() - processStartedAt, firstStdoutMs: firstStdoutAt === null ? null : firstStdoutAt - processStartedAt });
        const parseStartedAt = this.now(); const info = parseInfoJson(result.stdout);
        trace('GOG_INFO_JSON_PARSE', { success: Boolean(info), durationMs: this.now() - parseStartedAt, elapsedMs: this.now() - processStartedAt, stdoutBytes: Buffer.byteLength(String(result.stdout || '')), stderrBytes: Buffer.byteLength(String(result.stderr || '')) });
        if (!info) return { sizeReason: 'GOG_INFO_JSON_INVALID' };
        const sizes = selectedLanguageSize(info, language); if (!sizes) return { sizeReason: 'GOG_LANGUAGE_SIZE_UNAVAILABLE' };
        const value = { downloadSizeBytes: sizes.download, installedDiskSizeBytes: sizes.installed, sizeSource: 'gogdl-info', downloadSizeSource: 'gogdl-info', installedSizeSource: 'gogdl-info', buildId: String(info.buildId || '') || null, buildVersion: String(info.versionName || '') || null, language, sizeReason: null };
        trace('GOG_INFO_SIZE_RESULT', { ...value, dependencyCount: Array.isArray(info.dependencies) ? info.dependencies.length : 0, totalProviderDurationMs: this.now() - processStartedAt, totalResolverDurationMs: this.now() - resolverStartedAt });
        return value;
    }
}

module.exports = { GogRuntimeSizeResolver, parseInfoJson, resolveOwnedProductId, selectedLanguageSize, gogSizeKey };
