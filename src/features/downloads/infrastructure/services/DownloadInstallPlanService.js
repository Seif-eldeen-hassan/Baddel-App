'use strict';

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { inflateSync } = require('zlib');
const { InstallSizeResolutionCoordinator } = require('./InstallSizeResolutionCoordinator');

const RETRYABLE_SIZE_REASONS = new Set([
    'EPIC_INFO_UNAVAILABLE', 'EPIC_INFO_JSON_INVALID',
    'GOG_INFO_UNAVAILABLE', 'GOG_INFO_JSON_INVALID',
    'GOG_MANIFEST_NETWORK_ERROR', 'GOG_MANIFEST_HTTP_ERROR',
]);

const SIZE_FIELDS = ['totalBytes', 'expectedTotalBytes', 'downloadSizeBytes', 'installedDiskSizeBytes', 'sizeStatus', 'sizeSource', 'sizeReason', 'sizeCheckedAt', 'buildVersion', 'buildId', 'downloadSizeSource', 'installedSizeSource'];
function positive(value) { return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null; }
function typedSizeReason(error, platform) {
    const code = String(error?.code || '');
    if (/^(?:EPIC|GOG|SIZE|PROVIDER)_[A-Z0-9_]{2,80}$/.test(code)) return code;
    return platform === 'epic' ? 'EPIC_INFO_UNAVAILABLE' : platform === 'gog' ? 'GOG_MANIFEST_UNAVAILABLE' : 'PROVIDER_SIZE_UNAVAILABLE';
}
function stableSelectionValue(value) {
    if (Array.isArray(value)) return [...value].map(String).sort();
    return value == null || value === '' ? null : value;
}
function installSizeSelectionKey(payload = {}) {
    const platform = String(payload.platform || '').trim().toLowerCase();
    const installProvider = String(payload.installProvider || '').trim().toLowerCase();
    const accountId = String(payload.accountId || '').trim() || null;
    if (platform === 'epic' && installProvider === 'legendary') {
        return JSON.stringify([
            platform, installProvider, accountId,
            String(payload.providerAppName || payload.appName || '').trim() || null,
            payload.targetPlatform || 'Windows', payload.language || null,
            payload.sdlPolicy || 'skip-sdl', stableSelectionValue(payload.installTags),
            payload.dlcPolicy || 'skip-dlcs', payload.buildId || null, payload.buildVersion || null,
        ]);
    }
    if (platform === 'gog' && installProvider === 'gogdl') {
        const productId = String(payload.contentSystemProductId || payload.gogdlAppName || payload.gogProductId
            || payload.providerProductId || payload.providerAppName || '').replace(/^gog[-_]/i, '').trim() || null;
        return JSON.stringify([
            platform, installProvider, accountId, productId,
            String(payload.targetPlatform || 'windows').toLowerCase(), payload.language || 'en-US',
            payload.dlcPolicy || 'skip-dlcs', payload.buildId || null, payload.buildVersion || null,
        ]);
    }
    return JSON.stringify([platform || null, installProvider || null, accountId]);
}
function planKey(payload) {
    return JSON.stringify(['platform', 'installProvider', 'accountId', 'gameId', 'providerAppName', 'providerProductId', 'contentSystemProductId', 'gogdlAppName', 'gogProductId', 'canonicalGameId', 'installPath', 'language', 'installTags', 'sdlPolicy', 'dlcPolicy', 'targetPlatform', 'buildId', 'buildVersion'].map(key => stableSelectionValue(payload[key])));
}

// Only public Windows base-game manifest metadata is fetched. No runtime, auth refresh,
// install directory, or ownership marker is created by this observational service.
async function resolveGogManifestSizes(payload, fetchImpl = globalThis.fetch, trace = () => {}) {
    const id = String(payload.contentSystemProductId || payload.gogdlAppName || payload.gogProductId || payload.providerProductId || '');
    trace('GOG_SIZE_IDENTITY', { productId: id || null, identityValid: /^\d+$/.test(id) });
    if (!/^\d+$/.test(id)) return { sizeReason: 'GOG_IDENTITY_REQUIRES_PROVIDER_PREPARATION' };
    const signal = AbortSignal.timeout(10000);
    async function read(url, compressed = false) {
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:' || !['content-system.gog.com', 'gog-cdn.gcdn.co', 'cdn.gog.com'].includes(parsed.hostname)) throw Object.assign(new Error('Unsupported manifest host'), { code: 'GOG_MANIFEST_HOST_UNSUPPORTED' });
        trace('GOG_MANIFEST_REQUEST', { host: parsed.hostname, pathname: parsed.pathname, compressed });
        let response;
        try { response = await fetchImpl(url, { signal, redirect: 'error' }); }
        catch (error) { throw Object.assign(new Error('GOG manifest request failed'), { code: error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'GOG_MANIFEST_TIMEOUT' : 'GOG_MANIFEST_NETWORK_ERROR' }); }
        if (!response.ok) throw Object.assign(new Error('GOG manifest unavailable'), { code: 'GOG_MANIFEST_HTTP_ERROR' });
        const reader = response.body.getReader();
        let bytes = 0; const chunks = [];
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                bytes += value.length;
                if (bytes > 4 * 1024 * 1024) throw Object.assign(new Error('Manifest too large'), { code: 'GOG_MANIFEST_OUTPUT_TOO_LARGE' });
                chunks.push(Buffer.from(value));
            }
        } finally { await reader.cancel(); }
        const buffer = Buffer.concat(chunks);
        try {
            const value = JSON.parse((compressed ? inflateSync(buffer, { maxOutputLength: 16 * 1024 * 1024 }) : buffer).toString('utf8'));
            trace('GOG_MANIFEST_RESULT', { host: parsed.hostname, byteCount: bytes, parsed: true });
            return value;
        } catch { throw Object.assign(new Error('GOG manifest JSON invalid'), { code: 'GOG_MANIFEST_JSON_INVALID' }); }
    }
    const builds = await read(`https://content-system.gog.com/products/${id}/os/windows/builds?generation=2`);
    const build = builds.items?.find(item => String(item.product_id) === id && item.generation === 2 && item.public !== false && !item.branch);
    if (!build?.link) return { sizeReason: 'GOG_MANIFEST_UNAVAILABLE' };
    const meta = await read(build.link, true);
    if (String(meta.baseProductId) !== id || !Array.isArray(meta.depots)) return { sizeReason: 'GOG_MANIFEST_IDENTITY_MISMATCH' };
    const language = payload.language || 'en-US';
    const baseDepots = meta.depots.filter(depot => String(depot.productId) === id);
    if (baseDepots.some(depot => !Array.isArray(depot.languages))) return { sizeReason: 'GOG_LANGUAGE_SIZE_UNAVAILABLE' };
    const localized = baseDepots.filter(depot => !depot.languages.includes('*'));
    // Do not report only common files as the full game when language aliases are unresolved.
    if (localized.length && !localized.some(depot => depot.languages.includes(language))) return { sizeReason: 'GOG_LANGUAGE_SIZE_UNAVAILABLE' };
    const depots = baseDepots.filter(depot => depot.languages.some(lang => lang === '*' || lang === language));
    const sum = field => depots.length && depots.every(depot => Number.isSafeInteger(depot[field]) && depot[field] >= 0) ? positive(depots.reduce((total, depot) => total + depot[field], 0)) : null;
    // Dependencies are not all installed in the game directory. Until their exact
    // selection is known, report the incomplete plan as unknown, never sufficient.
    if (meta.dependencies?.length) return { sizeReason: 'GOG_DEPENDENCY_SIZE_UNAVAILABLE' };
    return { downloadSizeBytes: sum('compressedSize'), installedDiskSizeBytes: sum('size'), sizeSource: 'gog-public-windows-manifest', downloadSizeSource: 'gog-public-windows-manifest', installedSizeSource: 'gog-public-windows-manifest', buildVersion: String(build.version_name || build.build_id || ''), language };
}

class DownloadInstallPlanService {
    constructor({ fileSafety, getDrives = async () => [], resolveSizes = null, prepareSizePayload = async payload => payload, diagnostics = null, fsSync = fs, pathModule = path, now = Date.now, identityTimeoutMs = 10_000, maxTransientRetries = 1, retryDelayMs = 350 } = {}) {
        this.fileSafety = fileSafety;
        this.getDrives = getDrives;
        this.fs = fsSync;
        this.path = pathModule;
        this.now = now;
        this.diagnostics = diagnostics;
        this.resolveSizes = resolveSizes || (payload => payload.platform === 'gog' && payload.installProvider === 'gogdl' ? resolveGogManifestSizes(payload) : { sizeReason: 'SIZE_PROVIDER_UNSUPPORTED' });
        this.prepareSizePayload = prepareSizePayload;
        this.identityTimeoutMs = Math.max(100, Number(identityTimeoutMs) || 10_000);
        this.maxTransientRetries = Math.max(0, Math.min(1, Number(maxTransientRetries) || 0));
        this.retryDelayMs = Math.max(0, Number(retryDelayMs) || 0);
        this.plans = new Map();
        this.sizeCoordinator = new InstallSizeResolutionCoordinator({
            maxConcurrency: 2,
            maxBackgroundQueue: 8,
            now: this.now,
            execute: async payload => {
                try { return await this.resolveSizesWithRetry(payload); }
                catch (error) { return { sizeReason: typedSizeReason(error, payload.platform), _resolverErrorName: String(error?.name || 'Error').slice(0, 80) }; }
            },
        });
        this.pendingSizes = this.sizeCoordinator.entries;
    }
    async preparePayload(payload, context) {
        let timer;
        const timeout = new Promise((_resolve, reject) => {
            timer = setTimeout(() => {
                const error = new Error('Install-size account resolution timed out.');
                error.code = payload.platform === 'epic' ? 'EPIC_ACCOUNT_RESOLUTION_TIMEOUT' : 'GOG_ACCOUNT_RESOLUTION_TIMEOUT';
                reject(error);
            }, this.identityTimeoutMs);
            timer.unref?.();
        });
        try {
            return await Promise.race([Promise.resolve(this.prepareSizePayload(payload, context)), timeout]);
        } finally {
            clearTimeout(timer);
        }
    }
    async resolveSizesWithRetry(payload) {
        let value = await this.resolveSizes(payload);
        if (!RETRYABLE_SIZE_REASONS.has(String(value?.sizeReason || '')) || this.maxTransientRetries < 1) return value;
        this.diagnostics?.record?.(payload.installPlanCorrelationId, 'INSTALL_SIZE_RETRY_SCHEDULED', {
            sizeReason: value.sizeReason,
            retryDelayMs: this.retryDelayMs,
            attempt: 2,
        });
        await new Promise(resolve => setTimeout(resolve, this.retryDelayMs));
        return this.resolveSizes(payload);
    }

    disk(location) {
        try {
            let existing = location;
            while (!this.fs.existsSync(existing)) {
                const parent = this.path.dirname(existing);
                if (parent === existing) return { totalCapacityBytes: null, freeSpaceBytes: null };
                existing = parent;
            }
            const stats = this.fs.statfsSync(existing);
            const capacity = Number(stats.blocks) * Number(stats.bsize);
            const free = Number(stats.bavail) * Number(stats.bsize);
            return { totalCapacityBytes: Number.isFinite(capacity) && capacity >= 0 ? capacity : null, freeSpaceBytes: Number.isFinite(free) && free >= 0 ? free : null };
        } catch { return { totalCapacityBytes: null, freeSpaceBytes: null }; }
    }
    async storageOptions() {
        const drives = await this.getDrives();
        return drives.filter(drive => typeof drive.path === 'string' && this.path.isAbsolute(drive.path) && this.path.parse(drive.path).root === drive.path).map(drive => ({ root: drive.path, label: String(drive.label || 'Local Disk'), ...this.disk(drive.path) }));
    }
    async resolve(payload) {
        const correlationId = randomUUID();
        const planBindingKey = planKey(payload);
        payload = { ...payload, ...await this.preparePayload(payload, { purpose: 'foreground', correlationId }) };
        const requestStartedAt = Date.now();
        const record = (stage, value = {}) => this.diagnostics?.record?.(correlationId, stage, value);
        record('INSTALL_PLAN_REQUEST', {
            platform: payload.platform || null,
            installProvider: payload.installProvider || null,
            gameId: payload.gameId || null,
            canonicalGameId: payload.canonicalGameId || null,
            installPath: payload.installPath || null,
            rendererToIpcMs: Number.isFinite(payload.installPlanRendererStartedAt) && Number.isFinite(payload.installPlanIpcReceivedAt)
                ? Math.max(0, payload.installPlanIpcReceivedAt - payload.installPlanRendererStartedAt)
                : null,
            ipcToServiceMs: Number.isFinite(payload.installPlanIpcReceivedAt)
                ? Math.max(0, requestStartedAt - payload.installPlanIpcReceivedAt)
                : null,
        });
        record('INSTALL_PLAN_IDENTITY', { providerAppName: payload.providerAppName || null, providerProductId: payload.providerProductId || null, contentSystemProductId: payload.contentSystemProductId || null, namespace: payload.namespace || null, catalogItemId: payload.catalogItemId || null, accountId: payload.accountId || null });
        if (!({ epic: 'legendary', gog: 'gogdl' }[payload.platform] === payload.installProvider)) throw new Error('Choose a direct installation provider.');
        if (typeof payload.installPath !== 'string' || !this.path.isAbsolute(payload.installPath)) throw new Error('Choose an absolute game folder.');
        // Validate location without any size input or mutation. Preflight runs again at queue time.
        this.fileSafety.inspectInstallPath({ installPath: payload.installPath });
        const sizeKey = installSizeSelectionKey(payload);
        record('INSTALL_PLAN_SELECTION_KEY', { selectionKey: sizeKey });
        const sizeStartedAt = Date.now();
        record('INSTALL_PLAN_SIZE_RESOLVER_START', { cacheLayer: 'provider-scoped' });
        const coordinated = await this.sizeCoordinator.request(sizeKey, { ...payload, installPlanCorrelationId: correlationId }, {
            priority: 'foreground',
            onState: (state, details) => {
                if (state === 'queued') record('INSTALL_PLAN_PENDING_REQUEST', { coalesced: false, priority: 'foreground' });
                if (state === 'coalesced') record('INSTALL_PLAN_PENDING_REQUEST', { coalesced: true, priority: 'foreground', ...details });
            },
        });
        const cached = { value: coordinated.value || {} };
        if (cached.value._resolverErrorName) record('INSTALL_PLAN_SIZE_RESOLVER_ERROR', { sizeReason: cached.value.sizeReason, errorName: cached.value._resolverErrorName });
        else record('INSTALL_PLAN_SIZE_RESOLVER_RESULT', { coalesced: coordinated.coalesced, sizeReason: cached.value.sizeReason || null, downloadSizeBytes: positive(cached.value.downloadSizeBytes), installedDiskSizeBytes: positive(cached.value.installedDiskSizeBytes), sizeSource: cached.value.sizeSource || null });
        const sizeDurationMs = Date.now() - sizeStartedAt;
        const sizes = { downloadSizeBytes: positive(cached.value.downloadSizeBytes), installedDiskSizeBytes: positive(cached.value.installedDiskSizeBytes) };
        const requiredSpaceBytes = sizes.installedDiskSizeBytes ? this.fileSafety.calculateRequiredBytes(sizes) : null;
        const diskSafetyMarginBytes = requiredSpaceBytes === null ? null : this.fileSafety.calculateSafetyMargin(requiredSpaceBytes);
        const diskStartedAt = Date.now();
        const disk = this.disk(payload.installPath);
        const diskDurationMs = Date.now() - diskStartedAt;
        const totalRequiredBytes = requiredSpaceBytes === null ? null : requiredSpaceBytes + diskSafetyMarginBytes;
        const enoughSpace = totalRequiredBytes === null || disk.freeSpaceBytes === null ? null : disk.freeSpaceBytes >= totalRequiredBytes;
        const sizeStatus = sizes.downloadSizeBytes && sizes.installedDiskSizeBytes ? 'resolved' : 'unknown';
        const plan = {
            ...sizes, totalBytes: sizes.downloadSizeBytes, expectedTotalBytes: sizes.downloadSizeBytes,
            sizeStatus, sizeCheckedAt: new Date(this.now()).toISOString(),
            installPath: this.path.normalize(payload.installPath), requiredSpaceBytes, diskSafetyMarginBytes, totalRequiredBytes,
            ...disk, freeSpaceBytesAtQueue: disk.freeSpaceBytes, enoughSpace,
            missingSpaceBytes: enoughSpace === false ? totalRequiredBytes - disk.freeSpaceBytes : null,
            afterInstallBytes: totalRequiredBytes !== null && disk.freeSpaceBytes !== null ? disk.freeSpaceBytes - totalRequiredBytes : null,
            sizeSource: cached.value.sizeSource || null, sizeReason: cached.value.sizeReason || null,
            buildVersion: cached.value.buildVersion || null, buildId: cached.value.buildId || null,
            downloadSizeSource: cached.value.downloadSizeSource || cached.value.sizeSource || null,
            installedSizeSource: cached.value.installedSizeSource || cached.value.sizeSource || null, planId: randomUUID(), expiresAt: this.now() + 60000,
        };
        record('INSTALL_PLAN_DISK_RESULT', { installPath: plan.installPath, freeSpaceBytes: plan.freeSpaceBytes, totalCapacityBytes: plan.totalCapacityBytes, enoughSpace: plan.enoughSpace, diskDurationMs });
        record('INSTALL_PLAN_RESPONSE', { totalDurationMs: Date.now() - requestStartedAt, rendererRequestAgeAtMainResponseMs: Number.isFinite(payload.installPlanRendererStartedAt) ? Math.max(0, Date.now() - payload.installPlanRendererStartedAt) : null, sizeDurationMs, planId: plan.planId, sizeReason: plan.sizeReason, downloadSizeBytes: plan.downloadSizeBytes, installedDiskSizeBytes: plan.installedDiskSizeBytes, requiredSpaceBytes: plan.requiredSpaceBytes, diskSafetyMarginBytes: plan.diskSafetyMarginBytes, totalRequiredBytes: plan.totalRequiredBytes, freeSpaceBytes: plan.freeSpaceBytes, afterInstallBytes: plan.afterInstallBytes, enoughSpace: plan.enoughSpace });
        for (const [id, entry] of this.plans) if (entry.plan.expiresAt < this.now()) this.plans.delete(id);
        if (this.plans.size >= 100) this.plans.clear();
        this.plans.set(plan.planId, { key: planBindingKey, plan });
        return plan;
    }
    async prefetchSize(payload = {}) {
        const correlationId = randomUUID();
        const startedAt = Date.now();
        const record = (stage, value = {}) => this.diagnostics?.record?.(correlationId, stage, value);
        const expectedProvider = { epic: 'legendary', gog: 'gogdl' }[payload.platform];
        record('INSTALL_SIZE_PREFETCH_REQUEST', {
            platform: payload.platform || null,
            installProvider: payload.installProvider || null,
            accountId: payload.accountId || null,
            gameId: payload.gameId || null,
            canonicalGameId: payload.canonicalGameId || null,
            providerAppName: payload.providerAppName || null,
            providerProductId: payload.providerProductId || null,
        });
        if (!expectedProvider || payload.installProvider !== expectedProvider) {
            record('INSTALL_SIZE_PREFETCH_FAILED', { sizeReason: 'SIZE_PROVIDER_UNSUPPORTED', durationMs: Date.now() - startedAt });
            return { prefetchStatus: 'unsupported', sizeReason: 'SIZE_PROVIDER_UNSUPPORTED' };
        }
        const safePayload = { ...payload, ...await this.preparePayload(payload, { purpose: 'background', correlationId }) };
        delete safePayload.installPath;
        delete safePayload.installPlanId;
        const key = installSizeSelectionKey(safePayload);
        record('INSTALL_SIZE_PREFETCH_SELECTION_KEY', { selectionKey: key });
        const coordinated = await this.sizeCoordinator.request(key, { ...safePayload, installPlanCorrelationId: correlationId }, {
            priority: 'background',
            onState: (state, details) => {
                if (state === 'coalesced') record('INSTALL_SIZE_PREFETCH_COALESCED', details);
                if (state === 'started') record('INSTALL_SIZE_PREFETCH_PROVIDER_DISPATCHED', details);
                if (state === 'dropped') record('INSTALL_SIZE_PREFETCH_FAILED', details);
            },
        });
        const value = coordinated.value || {};
        const complete = positive(value.downloadSizeBytes) && positive(value.installedDiskSizeBytes) && value.sizeSource;
        record(complete ? 'INSTALL_SIZE_PREFETCH_COMPLETE' : 'INSTALL_SIZE_PREFETCH_FAILED', {
            durationMs: Date.now() - startedAt,
            coalesced: coordinated.coalesced,
            sizeReason: value.sizeReason || null,
            downloadSizeBytes: positive(value.downloadSizeBytes),
            installedDiskSizeBytes: positive(value.installedDiskSizeBytes),
            sizeSource: value.sizeSource || null,
        });
        return {
            prefetchStatus: complete ? 'ready' : 'unavailable',
            downloadSizeBytes: positive(value.downloadSizeBytes),
            installedDiskSizeBytes: positive(value.installedDiskSizeBytes),
            sizeSource: value.sizeSource || null,
            sizeReason: value.sizeReason || null,
            coalesced: coordinated.coalesced,
        };
    }
    applyPlan(payload) {
        if (!payload.installPlanId) return payload;
        const stored = this.plans.get(payload.installPlanId);
        if (!stored || stored.key !== planKey(payload) || stored.plan.expiresAt < this.now()) throw Object.assign(new Error('Storage preview expired or changed. Check the location again.'), { code: 'DOWNLOAD_INSTALL_PLAN_EXPIRED' });
        if (stored.plan.enoughSpace === false) throw Object.assign(new Error('Not enough space. Choose another drive.'), { code: 'DOWNLOAD_INSUFFICIENT_DISK_SPACE' });
        const result = { ...payload };
        for (const field of SIZE_FIELDS) result[field] = stored.plan[field];
        return result;
    }
}

module.exports = { DownloadInstallPlanService, resolveGogManifestSizes, planKey, installSizeSelectionKey, typedSizeReason, RETRYABLE_SIZE_REASONS };
