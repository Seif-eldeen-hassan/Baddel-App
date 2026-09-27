'use strict';

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { AtomicJsonFileStore } = require('../runtime/AtomicJsonFileStore');

const execFileAsync = promisify(execFile);
const SENSITIVE_KEY = /(authorization|cookie|token|secret|password|exchange.?code|auth.?code|sid)/i;
const SENSITIVE_TEXT = /(authorization|cookie|token|secret|password|exchange.?code|auth.?code)\s*[:=]\s*[^\s,;]+/gi;

function cleanString(value) {
    return String(value || '').replace(SENSITIVE_TEXT, '$1=[REDACTED]').slice(0, 2000);
}

function sanitize(value, depth = 0) {
    if (depth > 8) return '[MAX_DEPTH]';
    if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value === 'string') return cleanString(value);
    if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitize(item, depth + 1));
    if (typeof value !== 'object') return cleanString(value);
    const out = {};
    for (const [key, item] of Object.entries(value)) {
        out[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : sanitize(item, depth + 1);
    }
    return out;
}

function hashId(value) {
    return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 16);
}

function endpointSummary(rawUrl) {
    try {
        const url = new URL(rawUrl);
        return { hostname: url.hostname, path: url.pathname };
    } catch {
        return { hostname: 'invalid', path: '' };
    }
}

function errorSummary(error) {
    if (!error) return null;
    return sanitize({
        name: error.name || 'Error',
        code: error.code || null,
        message: error.message || String(error),
        failedStage: error.failedStage || null,
        stack: error.stack || null,
        cause: error.cause ? errorSummary(error.cause) : null,
        progress: error.progress || null,
    });
}

class EpicPriceDebugSession {
    constructor({ app, sourceFile, appStartedAt, store = new AtomicJsonFileStore(), enabled = null, flushEveryEvents = 20 }) {
        this.app = app;
        this.sourceFile = sourceFile;
        this.appStartedAt = appStartedAt;
        this.store = store;
        this.enabled = enabled === null ? process.env.BADDEL_EPIC_PRICE_DEBUG === '1' : enabled === true;
        this.flushEveryEvents = Math.max(1, Number(flushEveryEvents) || 20);
        this.lastFlushedCount = 0;
        this.runId = null;
        this.filePath = null;
        this.document = null;
        this.writeChain = Promise.resolve();
    }

    async start({ accountId, phaseState, source = 'retry' }) {
        if (!this.enabled) return this;
        this.runId = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
        this.filePath = path.join(this.app.getPath('userData'), 'platform-sync', 'diagnostics', `epic-price-debug-${this.runId}.json`);
        this.document = {
            version: 1,
            runId: this.runId,
            appStartedAt: this.appStartedAt,
            debugStartedAt: new Date().toISOString(),
            accountHash: hashId(accountId),
            source: String(source || 'retry'),
            lastSuccessfulCheckpoint: null,
            phaseStateAtStart: sanitize(phaseState),
            events: [],
        };
        await this.record('refresh_received', { source: String(source || 'retry') });
        return this;
    }

    async runtimeFingerprint() {
        if (!this.enabled) return null;
        let source = '';
        try { source = await fs.readFile(this.sourceFile, 'utf8'); } catch {}
        const loadedFiles = Object.keys(require.cache).map((file) => file.replace(/\\/g, '/'));
        const priceServiceFile = loadedFiles.find((file) => file.endsWith('/EpicPriceEnrichmentService.js'));
        let priceServiceSource = '';
        try { if (priceServiceFile) priceServiceSource = await fs.readFile(priceServiceFile, 'utf8'); } catch {}
        let gitHead = null;
        let gitStatus = null;
        if (!this.app.isPackaged) {
            try {
                gitHead = (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: this.app.getAppPath(), windowsHide: true })).stdout.trim();
                gitStatus = (await execFileAsync('git', ['status', '--short'], { cwd: this.app.getAppPath(), windowsHide: true, maxBuffer: 2 * 1024 * 1024 })).stdout.trim().split(/\r?\n/).filter(Boolean);
            } catch (error) {
                gitStatus = [`unavailable: ${cleanString(error.message)}`];
            }
        }
        const fingerprint = {
            appVersion: this.app.getVersion(),
            isPackaged: this.app.isPackaged,
            execPath: process.execPath,
            appPath: this.app.getAppPath(),
            resourcesPath: process.resourcesPath,
            sourceFile: this.sourceFile,
            loadedMarkers: {
                EpicPriceEnrichmentService: Boolean(priceServiceFile) && source.includes('EpicPriceEnrichmentService'),
                EPIC_PRICES_ZERO_COVERAGE: priceServiceSource.includes('EPIC_PRICES_ZERO_COVERAGE'),
                EpicEnrichmentScheduler: loadedFiles.some((file) => file.endsWith('/EpicEnrichmentScheduler.js')),
            },
            gitHead,
            gitStatus,
            appStartedAt: this.appStartedAt,
            runId: this.runId,
        };
        await this.record('runtime_fingerprint', fingerprint);
        return fingerprint;
    }

    async record(checkpoint, detail = {}) {
        if (!this.enabled || !this.document) return;
        const event = sanitize({ at: new Date().toISOString(), checkpoint, ...detail });
        this.document.events.push(event);
        this.document.lastSuccessfulCheckpoint = checkpoint;
        const terminal = /failed|completed|terminal_event_sent|timestamp_verified/.test(checkpoint);
        if (terminal || this.document.events.length - this.lastFlushedCount >= this.flushEveryEvents) await this.flush();
    }

    async flush() {
        if (!this.enabled || !this.document || this.document.events.length === this.lastFlushedCount) return;
        this.writeChain = this.writeChain.then(() => this.store.writeJson(this.filePath, this.document));
        await this.writeChain;
        this.lastFlushedCount = this.document.events.length;
    }

    async fail(error, detail = {}) {
        if (!this.enabled) return;
        await this.record('phase_failed', { ...detail, error: errorSummary(error) });
    }
}

module.exports = { EpicPriceDebugSession, endpointSummary, errorSummary, hashId, sanitize };
