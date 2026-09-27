'use strict';

const { performance, monitorEventLoopDelay } = require('node:perf_hooks');

function percentile(values, fraction) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))];
}

function summarize(values) {
    const finite = values.filter(Number.isFinite);
    return {
        count: finite.length,
        medianMs: percentile(finite, 0.5),
        p95Ms: percentile(finite, 0.95),
        maxMs: finite.length ? Math.max(...finite) : 0,
    };
}

class PerformanceDiagnostics {
    constructor({ enabled = process.env.BADDEL_PERF_DIAGNOSTICS === '1', maxSamples = 2000 } = {}) {
        this.enabled = enabled;
        this.maxSamples = maxSamples;
        this.startedAt = Date.now();
        this.ipc = new Map();
        this.rendererReports = [];
        this._installed = false;
        this._elu = performance.eventLoopUtilization();
        this._delay = null;
        if (enabled) {
            this._delay = monitorEventLoopDelay({ resolution: 10 });
            this._delay.enable();
        }
    }

    _push(map, key, value) {
        const list = map.get(key) || [];
        list.push(value);
        if (list.length > this.maxSamples) list.splice(0, list.length - this.maxSamples);
        map.set(key, list);
    }

    installIpcTiming(ipcMain) {
        if (!this.enabled || this._installed) return;
        this._installed = true;
        const originalHandle = ipcMain.handle.bind(ipcMain);
        ipcMain.handle = (channel, listener) => originalHandle(channel, async (...args) => {
            const started = performance.now();
            try {
                return await listener(...args);
            } finally {
                this._push(this.ipc, String(channel), performance.now() - started);
            }
        });
    }

    addRendererReport(report) {
        if (!this.enabled || !report || typeof report !== 'object') return false;
        this.rendererReports.push({
            capturedAt: Date.now(),
            interactions: Array.isArray(report.interactions) ? report.interactions.slice(-500) : [],
            longTasks: Array.isArray(report.longTasks) ? report.longTasks.slice(-500) : [],
            lifecycle: report.lifecycle && typeof report.lifecycle === 'object' ? report.lifecycle : {},
        });
        if (this.rendererReports.length > 20) this.rendererReports.shift();
        return true;
    }

    async snapshot({ app } = {}) {
        if (!this.enabled) return { enabled: false };
        const elu = performance.eventLoopUtilization(this._elu);
        this._elu = performance.eventLoopUtilization();
        const memory = await process.getProcessMemoryInfo().catch(() => null);
        const appMetrics = app?.getAppMetrics?.().map(metric => ({
            type: metric.type,
            cpuPercent: metric.cpu?.percentCPUUsage || 0,
            workingSetKb: metric.memory?.workingSetSize || 0,
            peakWorkingSetKb: metric.memory?.peakWorkingSetSize || 0,
        })) || [];
        const ipc = Object.fromEntries([...this.ipc].map(([channel, values]) => [channel, summarize(values)]));
        return {
            enabled: true,
            capturedAt: Date.now(),
            uptimeMs: Date.now() - this.startedAt,
            main: {
                eventLoopUtilization: elu.utilization,
                eventLoopDelay: this._delay ? {
                    meanMs: Number(this._delay.mean || 0) / 1e6,
                    p95Ms: Number(this._delay.percentile(95) || 0) / 1e6,
                    maxMs: Number(this._delay.max || 0) / 1e6,
                } : null,
                memory,
                appMetrics,
            },
            ipc,
            rendererReports: this.rendererReports.slice(-5),
        };
    }

    shutdown() {
        try { this._delay?.disable(); } catch {}
        this.ipc.clear();
        this.rendererReports.length = 0;
    }
}

module.exports = { PerformanceDiagnostics, summarize };
