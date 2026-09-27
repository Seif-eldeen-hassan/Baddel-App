'use strict';

const fs = require('fs');
const path = require('path');

const ARRAY_SECTIONS = new Set([
    'providerEvents',
    'progressPipeline',
    'completionTimeline',
    'executableCandidates',
    'playResolution',
]);
const LIMITS = Object.freeze({
    providerEvents: 400,
    progressPipeline: 500,
    completionTimeline: 100,
    executableCandidates: 300,
    playResolution: 300,
});
const SECRET_KEY_RE = /^(?:access[_-]?token|refresh[_-]?token|id[_-]?token|authorization(?:[_-]?header)?|cookie|cookies|password|secret|client[_-]?secret|auth(?:entication)?[_-]?(?:code|header))$/i;
const SECRET_VALUE_RE = /\b(Bearer\s+)[^\s"',}]+|\b(access[_-]?token|refresh[_-]?token|authorization|auth[_-]?code|cookie|password|secret)(["'\s:=]+)([^"'\s,}]+)/gi;

function diagnosticsEnabled(env = process.env) {
    return env.BADDEL_GOG_DOWNLOAD_DEBUG === '1' || env.BADDEL_DOWNLOAD_PROGRESS_DIAGNOSTICS === '1';
}

function progressDiagnosticsEnabled(env = process.env) {
    return env.BADDEL_DOWNLOAD_PROGRESS_DIAGNOSTICS === '1' || env.BADDEL_GOG_DOWNLOAD_DEBUG === '1';
}

function redactDiagnosticValue(value, seen = new WeakSet()) {
    if (typeof value === 'string') {
        return value.replace(SECRET_VALUE_RE, (_match, bearer, key, separator) => {
            if (bearer) return `${bearer}[REDACTED]`;
            return `${key}${separator}[REDACTED]`;
        });
    }
    if (value == null || typeof value !== 'object') return value;
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    if (Array.isArray(value)) return value.map(item => redactDiagnosticValue(item, seen));
    const out = {};
    for (const [key, child] of Object.entries(value)) {
        out[key] = SECRET_KEY_RE.test(key) ? '[REDACTED]' : redactDiagnosticValue(child, seen);
    }
    return out;
}

class DownloadDiagnosticRecorder {
    constructor({ userDataDir, env = process.env, fsModule = fs, pathModule = path, clock = Date, consoleRef = console } = {}) {
        if (!userDataDir) throw new Error('DownloadDiagnosticRecorder requires userDataDir');
        this.userDataDir = userDataDir;
        this.env = env;
        this.fs = fsModule;
        this.path = pathModule;
        this.clock = clock;
        this.console = consoleRef;
        this.reports = new Map();
        this.writeQueues = new Map();
        this.flushTimers = new Map();
    }

    isEnabled() {
        return diagnosticsEnabled(this.env);
    }

    isProgressEnabled() {
        return progressDiagnosticsEnabled(this.env);
    }

    getReportPath(taskId) {
        const safeId = String(taskId || 'unknown').replace(/[^a-z0-9_-]+/gi, '_').slice(0, 80) || 'unknown';
        return this.path.join(this.userDataDir, 'download-diagnostics', `${safeId}-full-debug.json`);
    }

    captureIdentity(task = {}) {
        if (!this.isEnabled() || !task?.id) return;
        const report = this.ensureReport(task.id);
        report.identity = redactDiagnosticValue({
            taskId: task.id,
            sessionId: task.progressSessionId || null,
            title: task.title || null,
            platform: task.platform || null,
            installPath: task.installPath || null,
            providerProductId: task.providerProductId || null,
            contentSystemProductId: task.contentSystemProductId || null,
            gogProductId: task.gogProductId || null,
            gogdlAppName: task.gogdlAppName || null,
            verificationExecutablePath: task.verificationExecutablePath || null,
            resolvedExecutablePath: task.resolvedExecutablePath || null,
        });
        this.scheduleFlush(task.id);
    }

    record(taskId, section, eventType, payload = {}, { flush = false } = {}) {
        if (!this.isEnabled() || !taskId || !section) return false;
        try {
            const report = this.ensureReport(taskId);
            const timestamp = new this.clock().toISOString();
            const entry = redactDiagnosticValue({ timestamp, taskId: String(taskId), eventType, ...payload });
            if (ARRAY_SECTIONS.has(section)) {
                report[section].push(entry);
                const limit = LIMITS[section] || 200;
                if (report[section].length > limit) report[section].splice(0, report[section].length - limit);
            } else {
                report[section] = entry;
            }
            report.updatedAt = timestamp;
            this.console?.info?.('[GOGDownloadDiagnostic]', JSON.stringify({ section, ...entry }));
            if (flush) this.flush(taskId).catch(() => {});
            else this.scheduleFlush(taskId);
            return true;
        } catch (_) {
            return false;
        }
    }

    mark(taskId, marker, payload = {}, options = {}) {
        if (!this.isEnabled() || !taskId) return false;
        const report = this.ensureReport(taskId);
        const nowMs = new this.clock().getTime();
        const previous = report.__lastCompletionMarkerAtMs;
        report.__lastCompletionMarkerAtMs = nowMs;
        return this.record(taskId, 'completionTimeline', marker, {
            marker,
            elapsedSincePreviousMarkerMs: Number.isFinite(previous) ? Math.max(0, nowMs - previous) : null,
            ...payload,
        }, options);
    }

    updateLivenessSummary(taskId, payload = {}) {
        if (!this.isEnabled() || !taskId) return false;
        try {
            const report = this.ensureReport(taskId);
            const timestamp = new this.clock().toISOString();
            report.livenessSummary = redactDiagnosticValue({
                ...(report.livenessSummary || {}),
                ...payload,
                updatedAt: timestamp,
            });
            report.updatedAt = timestamp;
            this.scheduleFlush(taskId);
            return true;
        } catch (_) {
            return false;
        }
    }

    async flush(taskId) {
        if (!this.isEnabled() || !taskId) return null;
        const id = String(taskId);
        const timer = this.flushTimers.get(id);
        if (timer) clearTimeout(timer);
        this.flushTimers.delete(id);
        const report = this.reports.get(id);
        if (!report) return null;
        const target = this.getReportPath(id);
        const write = async () => {
            const directory = this.path.dirname(target);
            const temp = `${target}.${process.pid}.tmp`;
            await this.fs.promises.mkdir(directory, { recursive: true });
            const serializable = { ...report };
            delete serializable.__lastCompletionMarkerAtMs;
            await this.fs.promises.writeFile(temp, `${JSON.stringify(redactDiagnosticValue(serializable), null, 2)}\n`, 'utf8');
            await this.fs.promises.rename(temp, target);
            return target;
        };
        const previous = this.writeQueues.get(id) || Promise.resolve();
        const queued = previous.then(write, write);
        this.writeQueues.set(id, queued);
        try { return await queued; } finally {
            if (this.writeQueues.get(id) === queued) this.writeQueues.delete(id);
        }
    }

    ensureReport(taskId) {
        const id = String(taskId);
        if (!this.reports.has(id)) {
            this.reports.set(id, {
                version: 1,
                createdAt: new this.clock().toISOString(),
                updatedAt: new this.clock().toISOString(),
                identity: {},
                providerEvents: [],
                progressPipeline: [],
                completionTimeline: [],
                executableCandidates: [],
                selectedExecutable: null,
                libraryRegistration: null,
                playResolution: [],
                finalLaunchTarget: null,
                livenessSummary: {
                    sessionId: null,
                    lastRealByteMovementAt: null,
                    lastPositiveNetworkAt: null,
                    lastPositiveDiskAt: null,
                    lastProviderActivityAt: null,
                    providerSilenceDurationMs: null,
                    byteStallDurationMs: null,
                    watchdogWarning: false,
                    hardStallDecision: false,
                    processPid: null,
                    processStatus: null,
                    updatedAt: null,
                },
                __lastCompletionMarkerAtMs: null,
            });
        }
        return this.reports.get(id);
    }

    scheduleFlush(taskId) {
        const id = String(taskId);
        if (this.flushTimers.has(id)) return;
        const timer = setTimeout(() => {
            this.flushTimers.delete(id);
            this.flush(id).catch(() => {});
        }, 250);
        timer.unref?.();
        this.flushTimers.set(id, timer);
    }
}

module.exports = {
    DownloadDiagnosticRecorder,
    diagnosticsEnabled,
    progressDiagnosticsEnabled,
    redactDiagnosticValue,
};
