'use strict';

const fs = require('fs');
const path = require('path');
const { createHash, randomUUID } = require('crypto');
const { execFile } = require('child_process');

const SENSITIVE = /access[_-]?token|refresh[_-]?token|authorization|exchange[_-]?code|(?:set-)?cookie|\bsid\b|\bbearer\b|[?&](?:token|signature|policy|key-pair-id|x-amz-[\w-]+)=/i;
const SECRET_KEY = /^(?:access[_-]?token|refresh[_-]?token|authorization|authorization_code|exchange_code|cookie|sid|password|secret)$/i;
const mask = value => value.replace(/[^\r\n\t ]/g, '*');

// Mask a whole sensitive line, preserving framing and offsets, not just a token regex match.
function sanitizeText(value) {
    let continuation = false;
    return String(value).split(/(?<=[\r\n])/).map(line => {
        const secret = SENSITIVE.test(line);
        const result = secret || continuation ? mask(line) : line;
        continuation = secret || (continuation && !/^\[[^\]\r\n]+\]\s+(?:DEBUG|INFO|WARNING|ERROR|CRITICAL):/.test(line));
        return result;
    }).join('');
}

function sanitize(value, depth = 0) {
    if (depth > 7) return '[DEPTH LIMIT]';
    if (typeof value === 'string') return sanitizeText(value).slice(0, 32768);
    if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
    if (Array.isArray(value)) return value.slice(0, 64).map(item => sanitize(item, depth + 1));
    if (typeof value !== 'object') return null;
    return Object.fromEntries(Object.entries(value).slice(0, 160).map(([key, item]) => [key, SECRET_KEY.test(key) ? '[REDACTED]' : sanitize(item, depth + 1)]));
}

const TASK_FIELDS = ('id platform installProvider status stage statusMessage taskRevision progressRevision progressSessionId ' +
    'downloadedBytes totalBytes progressPercent providerReportedPercent providerDownloadedBytes providerTotalBytes rawDownloadedBytes writtenBytes ' +
    'downloadSpeedBps rawDownloadSpeedBps decompressionSpeedBps diskWriteSpeedBps diskUsageBps telemetryState networkState ' +
    'etaSeconds etaSource etaUpdatedAt statusTextBeforeDebounce statusTextAfterDebounce statusChangeReason ' +
    'progressSource totalBytesSource downloadedBytesSource stableTotalBytes progressMode sessionDownloadedBytes sessionTotalBytes resumeBaseDownloadedBytes ' +
    'errorCode errorMessage processPid installedGameId resolvedExecutablePath verificationStatus').split(' ');

function taskValues(task = {}) {
    return Object.fromEntries(TASK_FIELDS.map(key => [key, task[key] ?? null]));
}

function infoCommand(executable, args) {
    return new Promise(resolve => execFile(executable, args, {
        shell: false, windowsHide: true, timeout: 15000, maxBuffer: 128 * 1024,
    }, (error, stdout, stderr) => resolve({ args, code: error?.code ?? 0, stdout: sanitizeText(stdout || ''), stderr: sanitizeText(stderr || '') })));
}

async function hashFile(filename) {
    const hash = createHash('sha256');
    for await (const chunk of fs.createReadStream(filename)) hash.update(chunk);
    return hash.digest('hex');
}

class EpicDownloadTrace {
    constructor({ userDataDir, enabled = process.env.BADDEL_EPIC_DOWNLOAD_TRACE === '1', probe = infoCommand, maxBytes = 256 * 1024 * 1024 } = {}) {
        this.enabled = enabled && Boolean(userDataDir);
        this.directory = userDataDir && path.join(userDataDir, 'download-diagnostics', 'epic-legendary');
        this.probe = probe;
        this.maxBytes = maxBytes;
        this.sessions = new Map();
        this.contexts = new WeakMap();
    }

    isEnabled() { return this.enabled; }
    has(taskId) { return this.sessions.has(taskId); }

    async begin(task, runtimeService, configPath) {
        if (!this.enabled || task.platform !== 'epic' || task.installProvider !== 'legendary') return false;
        await this.flush(task.id);
        const runtime = runtimeService.getRuntime();
        const session = {
            id: randomUUID(), taskId: task.id, progressSessionId: task.progressSessionId || null,
            seq: 0, chunkSeq: 0, buffer: [], bufferedBytes: 0, bytes: 0, writes: 0,
            chain: Promise.resolve(), revisions: new Map(), streams: {}, parserLines: {}, lastWritten: null,
        };
        session.path = path.join(this.directory, `${String(task.id).replace(/[^a-z0-9_-]/gi, '_')}-${session.id}.ndjson`);
        await fs.promises.mkdir(this.directory, { recursive: true });
        await fs.promises.writeFile(session.path, '', { flag: 'wx' });
        this.sessions.set(task.id, session);
        await fs.promises.writeFile(path.join(this.directory, 'latest-session.json'), JSON.stringify({ taskId: task.id, sessionId: session.id, path: session.path, state: 'capturing' }, null, 2));
        this.record(task.id, 'SESSION_START', { configPath, runtimePath: runtime.legendaryPath, runtimeOptions: runtimeService.runtimeOptions, pid: process.pid, task: taskValues(task) });
        const commands = [];
        for (const args of [['--version'], ['-V'], ['install', '--help']]) commands.push(await this.probe(runtime.legendaryPath, args));
        const debugSupported = commands.some(command => command.args[0] === 'install' && command.code === 0 && /--dlm-debug\b/.test(command.stdout + command.stderr));
        const sourceHashes = {};
        const root = runtimeService.runtimeOptions?.projectRoot || process.cwd();
        for (const relative of [
            'src/features/downloads/infrastructure/providers/epic/EpicLegendaryProgressParser.js',
            'src/features/downloads/infrastructure/providers/epic/EpicLegendaryDownloadAdapter.js',
            'src/features/downloads/domain/services/DownloadProgressReconciliation.js',
            'src/features/downloads/infrastructure/services/DownloadQueueManager.js',
            'src/features/downloads/infrastructure/services/DownloadTelemetryAggregator.js',
            'src/features/downloads/infrastructure/ipc/downloads.ipc.js', 'src/js/downloads.js', 'preload.js',
        ]) {
            try { sourceHashes[relative] = await hashFile(path.join(root, relative)); } catch { sourceHashes[relative] = 'unavailable'; }
        }
        this.record(task.id, 'RUNTIME_PROBE', { commands, debugSupported, sha256: await hashFile(runtime.legendaryPath), sourceHashes, hashMeaning: 'files on disk at session start; restart required to ensure loaded source matches' });
        await this.flush(task.id);
        return debugSupported;
    }

    record(taskId, event, payload = {}, context = null) {
        const session = this.sessions.get(taskId);
        if (!session || session.disabled) return;
        let row = JSON.stringify({ timestamp: new Date().toISOString(), monotonicMs: Number(process.hrtime.bigint() / 1000000n),
            sequence: ++session.seq, taskId, sessionId: session.id, progressSessionId: session.progressSessionId,
            event, correlation: context, payload: sanitize(payload) }) + '\n';
        if (session.bytes + Buffer.byteLength(row) > this.maxBytes || session.bufferedBytes > 4 * 1024 * 1024) {
            row = JSON.stringify({ event: 'TRACE_TRUNCATED', taskId, sessionId: session.id, reason: 'diagnostic safety limit; trace is incomplete' }) + '\n';
            session.disabled = true;
        }
        session.buffer.push(row);
        session.bytes += Buffer.byteLength(row);
        session.bufferedBytes += Buffer.byteLength(row);
        if (!session.timer) {
            session.timer = setTimeout(() => { session.timer = null; this.flush(taskId); }, 250);
            session.timer.unref?.();
        }
    }

    flush(taskId) {
        const session = this.sessions.get(taskId);
        if (!session) return Promise.resolve();
        clearTimeout(session.timer);
        session.timer = null;
        if (!session.buffer.length) return session.chain;
        const batch = session.buffer.join('');
        session.buffer = [];
        session.chain = session.chain.then(async () => {
            await fs.promises.appendFile(session.path, batch);
            session.writes += 1;
            session.bufferedBytes -= Buffer.byteLength(batch);
        }).catch(() => { session.disabled = true; });
        return session.chain;
    }

    raw(taskId, stream, chunk) {
        const session = this.sessions.get(taskId);
        if (!session || session.disabled) return;
        const state = session.streams[stream] ||= { parts: [], length: 0, line: 0, suppressContinuation: false };
        const chunkId = ++session.chunkSeq;
        const timestamp = new Date().toISOString();
        const text = String(chunk || '');
        this.record(taskId, 'RAW_CHUNK_RECEIVED', { stream, chunkId, timestamp, byteLength: Buffer.byteLength(chunk), textLength: text.length });
        let offset = 0;
        for (const piece of text.split(/(?<=[\r\n])/)) {
            if (!piece) continue;
            state.parts.push({ chunkId, timestamp, offset, text: piece });
            state.length += piece.length;
            offset += piece.length;
            if (/[\r\n]$/.test(piece)) this.rawLine(taskId, stream, state);
            else if (state.length > 65536) {
                this.record(taskId, 'RAW_LINE_SUPPRESSED', { stream, reason: 'unterminated line exceeded 64KiB; no partial credentials persisted' });
                state.parts = []; state.length = 0; state.suppressContinuation = true;
            }
        }
    }

    rawLine(taskId, stream, state) {
        const line = state.parts.map(part => part.text).join('');
        const secret = SENSITIVE.test(line);
        const redacted = secret || state.suppressContinuation;
        const safeLine = redacted ? mask(line) : line;
        const lineId = `${stream}:${++state.line}`;
        // A secret may span pretty-printed/multiline values. Resume only at a new logger record.
        state.suppressContinuation = secret || (state.suppressContinuation && !/^\[[^\]\r\n]+\]\s+(?:DEBUG|INFO|WARNING|ERROR|CRITICAL):/.test(line));
        let offset = 0;
        for (const part of state.parts) {
            this.record(taskId, 'RAW_CHUNK_SEGMENT', { stream, chunkId: part.chunkId, timestamp: part.timestamp, offset: part.offset,
                rawSanitizedChunk: safeLine.slice(offset, offset + part.text.length), redacted }, { lineId, stream });
            offset += part.text.length;
        }
        this.record(taskId, 'RAW_LINE', { rawSanitizedLine: safeLine, redacted }, { lineId, stream });
        state.parts = []; state.length = 0;
    }

    parser(taskId, stream, line, event) {
        const session = this.sessions.get(taskId);
        if (!session) return;
        const index = (session.parserLines[stream] || 0) + 1;
        session.parserLines[stream] = index;
        const context = { lineId: `${stream}:${index}`, stream };
        if (event) this.contexts.set(event, context);
        // Raw text lives exclusively in the streaming redactor, never in this callback.
        this.record(taskId, 'PARSER', { parser: event, ignored: !event, inputLength: line.length,
            providerPhasePercent: event?.progressPercent ?? null,
            rawDownloadSpeedBps: event?.downloadSpeedBps ?? null, decompressionSpeedBps: event?.decompressionSpeedBps ?? null,
            diskWriteSpeedBps: event?.diskUsageBps ?? null }, context);
    }

    adapter(taskId, event, before, patch) {
        const session = this.sessions.get(taskId);
        if (!session) return;
        const context = this.contexts.get(event) || null;
        this.contexts.set(patch, context);
        this.record(taskId, 'ADAPTER', { adapterStateBefore: { ...before, lastWritten: session.lastWritten, lastWrittenSource: 'diagnostic-only observer; adapter has no lastWritten field' }, adapterPatch: patch }, context);
        if (event.writtenBytes != null) session.lastWritten = event.writtenBytes;
    }

    pipeline(taskId, patch, event, payload) {
        const session = this.sessions.get(taskId);
        if (!session) return;
        if (patch.sessionId && !session.progressSessionId) session.progressSessionId = patch.sessionId;
        const context = this.contexts.get(patch) || null;
        if (payload.queueTaskAfter) {
            session.revisions.set(payload.queueTaskAfter.taskRevision, context);
            if (session.revisions.size > 20000) session.revisions.delete(session.revisions.keys().next().value);
        }
        this.record(taskId, event, payload, context);
    }

    ipc(event, payload) {
        const tasks = Array.isArray(payload?.tasks) ? payload.tasks : [payload];
        for (const task of tasks) {
            const session = this.sessions.get(task?.id || task?.taskId);
            if (!session) continue;
            this.record(session.taskId, 'IPC_SEND', { channel: event, task: taskValues(task), patch: task.patch }, session.revisions.get(task.taskRevision) || null);
        }
    }

    renderer(taskId, event, payload) {
        if (!/^RENDERER_/.test(event) || !this.sessions.has(taskId) || JSON.stringify(payload).length > 32768) return false;
        const session = this.sessions.get(taskId);
        const sameSession = !payload.progressSessionId || payload.progressSessionId === session.progressSessionId;
        this.record(taskId, event, { ...payload, sameSession }, sameSession ? session.revisions.get(payload.taskRevision) || null : null);
        return true;
    }

    endProvider(taskId, code, signal, failureCode) {
        const session = this.sessions.get(taskId);
        if (!session) return;
        for (const [stream, state] of Object.entries(session.streams)) if (state.parts.length) this.rawLine(taskId, stream, state);
        this.record(taskId, 'PROVIDER_CLOSE', { code, signal, failureCode, diagnosticDiskWrites: session.writes, capturedBytes: session.bytes });
        this.flush(taskId);
    }
}

let recorder = null;
// All observations are failure-isolated; diagnostics must never decide download outcomes.
const epicTrace = {};
for (const method of Object.getOwnPropertyNames(EpicDownloadTrace.prototype).filter(name => name !== 'constructor')) {
    epicTrace[method] = (...args) => {
        try {
            const result = recorder?.[method](...args);
            return result?.catch ? result.catch(() => false) : result;
        } catch { return false; }
    };
}
function configureEpicTrace(options) { recorder = new EpicDownloadTrace(options); return epicTrace; }

module.exports = { EpicDownloadTrace, epicTrace, configureEpicTrace, sanitizeText, taskValues };
