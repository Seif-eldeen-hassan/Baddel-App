'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const CHANNELS = new Set(['get-cached-images-bulk', 'get-grid-artwork-thumbnails']);
const NUMBERS = ['at', 'id', 'durationMs', 'count', 'hits', 'misses', 'readMs', 'loopLagMs',
    'cards', 'images', 'local', 'decoded', 'shown', 'visible', 'visibleShown', 'library',
    'completed', 'total', 'pending', 'calls', 'maxMs', 'failures', 'bytes', 'downloads'];

// No titles, identities, paths, URLs, payloads, or exception messages enter the trace.
function sanitize(value = {}) {
    const out = {};
    for (const key of NUMBERS) if (typeof value[key] === 'number' && Number.isFinite(value[key])) out[key] = value[key];
    return out;
}

const RENDERER_SAMPLE = `(() => {
    const cards = [...document.querySelectorAll('#allGamesGrid .game-card')];
    const counts = { at: Date.now(), cards: cards.length, images: 0, local: 0, decoded: 0, shown: 0, visible: 0, visibleShown: 0,
        library: window._allGamesCache?.length || 0,
        completed: window.__agApplicationArtworkHydration?.completed || 0,
        total: window.__agApplicationArtworkHydration?.total || 0 };
    for (const card of cards) {
        const rect = card.getBoundingClientRect();
        const visible = rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth && rect.width > 0;
        if (visible) counts.visible++;
        const img = card.querySelector('img.game-card-img');
        if (!img) continue;
        counts.images++;
        if ((img.currentSrc || img.src || '').startsWith('file:')) counts.local++;
        const decoded = img.complete && img.naturalWidth > 0;
        if (decoded) counts.decoded++;
        const style = getComputedStyle(img);
        if (decoded && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0) {
            counts.shown++; if (visible) counts.visibleShown++;
        }
    }
    return counts;
})()`;

class ArtworkStartupDiagnostics {
    constructor({ enabled = process.env.BADDEL_ARTWORK_STARTUP_TRACE === '1', durationMs = 120000 } = {}) {
        this.enabled = enabled;
        this.startedAt = Date.now();
        this.durationMs = durationMs;
        this.events = [];
        this.metrics = {};
        this.active = new Set();
        this.sequence = 0;
        this.closed = false;
    }
    record(stage, values = {}) {
        if (!this.enabled || this.closed || this.events.length >= 6000) return;
        this.events.push({ stage, ...sanitize(values), elapsedMs: Date.now() - this.startedAt });
    }
    install(ipcMain) {
        if (!this.enabled || this.installed) return;
        this.installed = true;
        ipcMain.on('artwork-startup-trace:preload', (event, payload) => {
            if (event.senderFrame && event.sender.mainFrame && event.senderFrame !== event.sender.mainFrame) return;
            if (!CHANNELS.has(payload?.channel)) return;
            if (!['invoke', 'resolved', 'rejected'].includes(payload?.stage)) return;
            this.record(`preload:${payload.channel}:${payload.stage}`, payload);
        });
        const handle = ipcMain.handle.bind(ipcMain);
        ipcMain.handle = (channel, listener) => {
            if (!CHANNELS.has(channel)) return handle(channel, listener);
            this.record(`registered:${channel}`);
            return handle(channel, async (...args) => {
                const id = ++this.sequence;
                const started = performance.now();
                this.active.add(id);
                this.record(`main:${channel}:enter`, { id, at: Date.now(), count: Array.isArray(args[1]) ? args[1].length : 0 });
                try {
                    const result = await listener(...args);
                    this.record(`main:${channel}:return`, { id, durationMs: performance.now() - started,
                        hits: Object.keys(result?.images || {}).length, misses: Number(result?.misses || 0) });
                    return result;
                } catch (error) {
                    this.record(`main:${channel}:reject`, { id, durationMs: performance.now() - started });
                    throw error;
                } finally { this.active.delete(id); }
            });
        };
    }
    observe(target, method, label) {
        if (!this.enabled || !target || typeof target[method] !== 'function') return;
        const original = target[method];
        const self = this;
        target[method] = function (...args) {
            const started = performance.now();
            try { return original.apply(this, args); }
            finally {
                if (!self.closed) {
                    const metric = self.metrics[label] || (self.metrics[label] = { calls: 0, durationMs: 0, maxMs: 0 });
                    const elapsed = performance.now() - started;
                    metric.calls++; metric.durationMs += elapsed; metric.maxMs = Math.max(metric.maxMs, elapsed);
                }
            }
        };
    }
    start(app, getWindow, getNetwork) {
        if (!this.enabled || this.timer) return;
        this.record('app-ready');
        this.output = path.join(app.getPath('userData'), 'artwork-startup-diagnostics', 'latest.json');
        this.runtime = { version: app.getVersion(), packaged: app.isPackaged, electron: process.versions.electron,
            traceVersion: 1, profileName: path.basename(app.getPath('userData')) === 'baddel-launcher-beta' ? 'baddel-launcher-beta' : 'other' };
        let expected = Date.now() + 2000;
        this.timer = setInterval(() => {
            this.record('main-tick', { loopLagMs: Math.max(0, Date.now() - expected), pending: this.active.size });
            expected = Date.now() + 2000;
            const stats = getNetwork?.() || {};
            this.record('network-totals', { downloads: Number(stats.completedDownloads || 0), bytes: Number(stats.downloadedBytes || 0) });
            const window = getWindow();
            if (window && !window.isDestroyed() && !this.sampling) {
                this.sampling = true;
                this.record('renderer-sample-request');
                window.webContents.executeJavaScript(RENDERER_SAMPLE).then(value => {
                    this.record('renderer-sample', value);
                }, () => this.record('renderer-sample-failed')).finally(() => { this.sampling = false; });
            }
            if (Date.now() - this.startedAt >= this.durationMs) this.stop();
            else this.flush();
        }, 2000);
        this.timer.unref?.();
        app.once('before-quit', () => this.stop());
        this.flush();
    }
    flush() {
        if (!this.output || this.writing) return;
        this.writing = true;
        const snapshot = JSON.stringify({ startedAt: this.startedAt, capturedAt: Date.now(), complete: this.closed,
            runtime: this.runtime, activeRequests: [...this.active], metrics: this.metrics, events: this.events });
        fs.promises.mkdir(path.dirname(this.output), { recursive: true })
            .then(() => fs.promises.writeFile(this.output + '.tmp', snapshot))
            .then(() => fs.promises.rename(this.output + '.tmp', this.output))
            .catch(() => { this.writeFailed = true; })
            .finally(() => { this.writing = false; if (this.finalFlushPending) { this.finalFlushPending = false; this.flush(); } });
    }
    stop() {
        if (this.closed) return;
        this.record('trace-complete', { pending: this.active.size });
        this.closed = true;
        clearInterval(this.timer);
        if (this.writing) this.finalFlushPending = true;
        else this.flush();
    }
}
module.exports = { ArtworkStartupDiagnostics, sanitize, RENDERER_SAMPLE };
