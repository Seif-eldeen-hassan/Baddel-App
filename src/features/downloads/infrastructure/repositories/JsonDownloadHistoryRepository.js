'use strict';

const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

function safeText(value, max = 512) {
    return value == null ? null : String(value).replace(/[\x00-\x1f]/g, '').trim().slice(0, max) || null;
}

function safeArtwork(value) {
    const text = safeText(value, 2048);
    if (!text || /^(?:data|blob|javascript):/i.test(text)) return null;
    if (/^https?:/i.test(text)) {
        try {
            const parsed = new URL(text);
            if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
            parsed.username = '';
            parsed.password = '';
            parsed.search = '';
            parsed.hash = '';
            return parsed.toString();
        } catch { return null; }
    }
    return text;
}

function safeSize(...values) {
    for (const value of values) {
        const number = Number(value);
        if (Number.isSafeInteger(number) && number > 0) return number;
    }
    return null;
}

function historyIdentity(task = {}) {
    const taskId = safeText(task.id, 160) || 'unknown';
    const status = String(task.status || '').toLowerCase();
    const attempt = safeText(task.startedAt || task.queuedAt || task.createdAt, 80) || 'unknown';
    const finished = status === 'completed' ? safeText(task.completedAt, 80) || attempt : attempt;
    const retry = Number.isInteger(Number(task.retryCount)) ? Number(task.retryCount) : 0;
    return crypto.createHash('sha256').update(`${taskId}|${retry}|${status}|${attempt}|${finished}`).digest('hex').slice(0, 32);
}

function toHistoryRecord(task = {}, clock = Date) {
    const status = String(task.status || '').toLowerCase();
    if (!TERMINAL_STATUSES.has(status)) return null;
    const finishedAt = task.completedAt || task.failedAt || task.cancelledAt || task.updatedAt || new clock().toISOString();
    return {
        id: historyIdentity(task),
        taskId: safeText(task.id, 160),
        title: safeText(task.title, 300) || 'Unknown Game',
        artworkUrl: safeArtwork(task.coverUrl || task.heroUrl),
        platform: String(task.platform || task.installProvider || 'unknown').toLowerCase() === 'gogdl'
            ? 'gog'
            : (safeText(task.platform || task.installProvider, 40) || 'unknown').toLowerCase(),
        provider: safeText(task.installProvider, 80)?.toLowerCase() || null,
        status,
        startedAt: task.startedAt || task.queuedAt || task.createdAt || null,
        finishedAt,
        sizeBytes: safeSize(task.installedDiskSizeBytes, task.totalBytes, task.downloadedBytes),
    };
}

class JsonDownloadHistoryRepository {
    constructor({ userDataDir, fileName = 'download-history.json', clock = Date } = {}) {
        if (!userDataDir) throw new Error('JsonDownloadHistoryRepository requires userDataDir');
        this.downloadsDir = path.join(userDataDir, 'downloads');
        this.historyFile = path.join(this.downloadsDir, fileName);
        this.clock = clock;
        this.writeTail = Promise.resolve();
    }

    async ensureDir() {
        await fs.mkdir(this.downloadsDir, { recursive: true });
    }

    emptyState() {
        return { version: 1, entries: [], updatedAt: new this.clock().toISOString() };
    }

    normalizeState(value = {}) {
        const byId = new Map();
        for (const entry of Array.isArray(value.entries) ? value.entries : []) {
            if (!entry || !safeText(entry.id, 64) || !TERMINAL_STATUSES.has(String(entry.status || '').toLowerCase())) continue;
            const safe = {
                id: safeText(entry.id, 64), taskId: safeText(entry.taskId, 160),
                title: safeText(entry.title, 300) || 'Unknown Game', artworkUrl: safeArtwork(entry.artworkUrl),
                platform: safeText(entry.platform, 40)?.toLowerCase() || 'unknown',
                provider: safeText(entry.provider, 80)?.toLowerCase() || null,
                status: String(entry.status).toLowerCase(), startedAt: entry.startedAt || null,
                finishedAt: entry.finishedAt || null, sizeBytes: safeSize(entry.sizeBytes),
            };
            byId.set(safe.id, safe);
        }
        return {
            version: 1,
            entries: [...byId.values()].sort((a, b) => Date.parse(b.finishedAt || '') - Date.parse(a.finishedAt || '')),
            updatedAt: value.updatedAt || new this.clock().toISOString(),
        };
    }

    async readState() {
        try {
            return this.normalizeState(JSON.parse(await fs.readFile(this.historyFile, 'utf8')));
        } catch (error) {
            if (error?.code !== 'ENOENT') await this.backupCorruptFile();
            return this.emptyState();
        }
    }

    async backupCorruptFile() {
        try {
            await this.ensureDir();
            const stamp = new this.clock().toISOString().replace(/[:.]/g, '-');
            await fs.copyFile(this.historyFile, `${this.historyFile}.corrupt-${stamp}.bak`);
        } catch (_) {}
    }

    async writeState(state) {
        await this.ensureDir();
        const normalized = this.normalizeState({ ...state, updatedAt: new this.clock().toISOString() });
        const temporary = `${this.historyFile}.tmp`;
        await fs.writeFile(temporary, JSON.stringify(normalized, null, 2), 'utf8');
        await fs.rename(temporary, this.historyFile);
        return normalized;
    }

    async archive(task) {
        const record = toHistoryRecord(task, this.clock);
        if (!record) return this.list();
        const write = async () => {
            const state = await this.readState();
            const index = state.entries.findIndex(entry => entry.id === record.id);
            if (index >= 0) state.entries[index] = { ...state.entries[index], ...record };
            else state.entries.push(record);
            return this.writeState(state);
        };
        this.writeTail = this.writeTail.then(write, write);
        const state = await this.writeTail;
        return state.entries;
    }

    async archiveMany(tasks = []) {
        for (const task of tasks) await this.archive(task);
        return this.list();
    }

    async list() {
        await this.writeTail.catch(() => {});
        return (await this.readState()).entries;
    }

    async clear() {
        const write = () => this.writeState(this.emptyState());
        this.writeTail = this.writeTail.then(write, write);
        await this.writeTail;
        return [];
    }
}

module.exports = { JsonDownloadHistoryRepository, toHistoryRecord, historyIdentity };
