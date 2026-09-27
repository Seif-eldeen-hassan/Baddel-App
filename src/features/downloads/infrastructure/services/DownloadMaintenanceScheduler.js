'use strict';

const UPDATE_CHECK_TTL_MS = 24 * 60 * 60 * 1000;
const UPDATE_CHECK_SWEEP_INTERVAL_MS = 60 * 60 * 1000;
const UPDATE_CHECK_INITIAL_DELAY_MS = 10 * 1000;
const { UPDATE_CHECK_CONCURRENCY } = require('./UpdateCheckCoordinator');
const ELIGIBLE_PROVIDERS = new Set(['gog:gogdl', 'epic:legendary']);

function managedIdentity(record = {}) {
    return `${record.platform || ''}:${record.installProvider || ''}:${record.installedGameId || ''}`;
}

class DownloadMaintenanceScheduler {
    constructor({
        queueManager,
        diagnosticRecorder = null,
        clock = Date,
        ttlMs = UPDATE_CHECK_TTL_MS,
        sweepIntervalMs = UPDATE_CHECK_SWEEP_INTERVAL_MS,
        initialDelayMs = UPDATE_CHECK_INITIAL_DELAY_MS,
        concurrency = UPDATE_CHECK_CONCURRENCY,
        setTimeoutFn = setTimeout,
        clearTimeoutFn = clearTimeout,
        setIntervalFn = setInterval,
        clearIntervalFn = clearInterval,
        logger = console,
    } = {}) {
        if (!queueManager) throw new Error('DownloadMaintenanceScheduler requires queueManager');
        this.queueManager = queueManager;
        this.diagnosticRecorder = diagnosticRecorder;
        this.clock = clock;
        this.ttlMs = Math.max(1, Number(ttlMs) || UPDATE_CHECK_TTL_MS);
        this.sweepIntervalMs = Math.max(1, Number(sweepIntervalMs) || UPDATE_CHECK_SWEEP_INTERVAL_MS);
        this.initialDelayMs = Math.max(0, Number(initialDelayMs) || 0);
        this.concurrency = Math.max(1, Math.min(2, Number(concurrency) || UPDATE_CHECK_CONCURRENCY));
        this.setTimeoutFn = setTimeoutFn;
        this.clearTimeoutFn = clearTimeoutFn;
        this.setIntervalFn = setIntervalFn;
        this.clearIntervalFn = clearIntervalFn;
        this.logger = logger;
        this.initialTimer = null;
        this.intervalTimer = null;
        this.sweepPromise = null;
        this.started = false;
    }

    start() {
        if (this.started) return;
        this.started = true;
        this.initialTimer = this.setTimeoutFn(() => {
            this.initialTimer = null;
            this.sweep().catch(error => this.logSweepFailure(error));
        }, this.initialDelayMs);
        this.initialTimer?.unref?.();
        this.intervalTimer = this.setIntervalFn(() => {
            this.sweep().catch(error => this.logSweepFailure(error));
        }, this.sweepIntervalMs);
        this.intervalTimer?.unref?.();
    }

    stop() {
        if (this.initialTimer) this.clearTimeoutFn(this.initialTimer);
        if (this.intervalTimer) this.clearIntervalFn(this.intervalTimer);
        this.initialTimer = null;
        this.intervalTimer = null;
        this.started = false;
    }

    isEligible(record = {}, nowMs = new this.clock().getTime()) {
        if (!record.taskId || !record.installedGameId || !record.installPath) return false;
        if (!ELIGIBLE_PROVIDERS.has(`${record.platform}:${record.installProvider}`)) return false;
        if (String(record.status || '') !== 'completed') return false;
        if (this.queueManager.hasMaintenanceRequestForTask?.(record.taskId)) return false;
        if (record.checkingForUpdate === true) return false;
        const checkedAt = Date.parse(record.updateCheckedAt || '');
        return !Number.isFinite(checkedAt) || nowMs - checkedAt >= this.ttlMs;
    }

    async sweep() {
        if (this.sweepPromise) return this.sweepPromise;
        this.sweepPromise = this.runSweep();
        try { return await this.sweepPromise; } finally { this.sweepPromise = null; }
    }

    async runSweep() {
        await this.queueManager.ensureLoaded();
        const nowMs = new this.clock().getTime();
        const stale = (this.queueManager.getSnapshot().managedInstallations || [])
            .filter(record => this.isEligible(record, nowMs));
        const results = await Promise.all(stale.map(record => this.checkRecord(record)));
        return { checked: results.filter(result => result.status === 'success').length, failed: results.filter(result => result.status === 'error').length, selected: stale.length, results };
    }

    async checkRecord(record) {
        const identity = managedIdentity(record);
        try {
                await this.queueManager.checkForUpdate(record.taskId, { priority: 'background' });
                return { status: 'success', taskId: record.taskId, identity };
        } catch (error) {
                const safe = { code: error?.code || 'DOWNLOAD_BACKGROUND_UPDATE_CHECK_FAILED', message: String(error?.message || 'Background update check failed').slice(0, 240) };
                this.diagnosticRecorder?.record?.(record.taskId, 'backgroundUpdateCheck', 'BACKGROUND_UPDATE_CHECK_FAILED', safe);
                this.logger?.warn?.('[Downloads] background update check failed', { taskId: record.taskId, platform: record.platform, code: safe.code });
                return { status: 'error', taskId: record.taskId, identity, code: safe.code };
        }
    }

    logSweepFailure(error) {
        this.logger?.warn?.('[Downloads] background update sweep failed', { code: error?.code || 'DOWNLOAD_BACKGROUND_UPDATE_SWEEP_FAILED' });
    }
}

module.exports = {
    DownloadMaintenanceScheduler,
    UPDATE_CHECK_TTL_MS,
    UPDATE_CHECK_SWEEP_INTERVAL_MS,
    UPDATE_CHECK_INITIAL_DELAY_MS,
    UPDATE_CHECK_CONCURRENCY,
    managedIdentity,
};
