'use strict';

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { normalizeTask, DOWNLOAD_STATUSES } = require('../../domain/entities/DownloadTask');

class JsonDownloadRepository {
    constructor({ userDataDir, fileName = 'downloads-queue.json' } = {}) {
        if (!userDataDir) throw new Error('JsonDownloadRepository requires userDataDir');
        this.downloadsDir = path.join(userDataDir, 'downloads');
        this.queueFile = path.join(this.downloadsDir, fileName);
    }

    async ensureDir() {
        await fs.mkdir(this.downloadsDir, { recursive: true });
    }

    async readState() {
        try {
            const raw = await fs.readFile(this.queueFile, 'utf8');
            const parsed = JSON.parse(raw);
            return this.normalizeState(parsed);
        } catch (err) {
            if (err && err.code === 'ENOENT') return this.emptyState();
            await this.backupCorruptFile();
            return this.emptyState({ recoveredCorruptFile: true });
        }
    }

    readStateSync() {
        try {
            const raw = fsSync.readFileSync(this.queueFile, 'utf8');
            return this.normalizeState(JSON.parse(raw));
        } catch (err) {
            return this.emptyState();
        }
    }

    async writeState(state) {
        await this.ensureDir();
        const normalized = this.normalizeState(state, { recoverInterrupted: false });
        const tmp = `${this.queueFile}.tmp`;
        await fs.writeFile(tmp, JSON.stringify(normalized, null, 2), 'utf8');
        await fs.rename(tmp, this.queueFile);
        return normalized;
    }

    async backupCorruptFile() {
        try {
            await this.ensureDir();
            const stamp = new Date().toISOString().replace(/[:.]/g, '-');
            await fs.copyFile(this.queueFile, `${this.queueFile}.corrupt-${stamp}.bak`);
        } catch (_) {}
    }

    emptyState(extra = {}) {
        return {
            version: 1,
            tasks: [],
            settings: {
                askInstallLocation: true,
                autoStartNext: true,
                keepCompletedHistory: true,
                defaultInstallRoots: {
                    epic: null,
                    gog: null,
                },
            },
            updatedAt: new Date().toISOString(),
            ...extra,
        };
    }

    normalizeState(state = {}, { recoverInterrupted = true } = {}) {
        const base = this.emptyState();
        const tasks = Array.isArray(state.tasks)
            ? state.tasks.map(t => normalizeTask(recoverInterrupted ? this.recoverInterruptedTask(t) : t))
            : [];
        return {
            ...base,
            ...state,
            version: 1,
            settings: {
                ...base.settings,
                ...(state.settings && typeof state.settings === 'object' ? state.settings : {}),
                defaultInstallRoots: {
                    ...base.settings.defaultInstallRoots,
                    ...(state.settings?.defaultInstallRoots || {}),
                },
            },
            tasks,
            updatedAt: state.updatedAt || base.updatedAt,
        };
    }

    recoverInterruptedTask(task = {}) {
        if ([
            DOWNLOAD_STATUSES.PREPARING,
            DOWNLOAD_STATUSES.DOWNLOADING,
            DOWNLOAD_STATUSES.PAUSING,
            DOWNLOAD_STATUSES.RESUMING,
            DOWNLOAD_STATUSES.VERIFYING,
            DOWNLOAD_STATUSES.INSTALLING,
        ].includes(task.status)) {
            return {
                ...task,
                status: DOWNLOAD_STATUSES.PAUSED,
                stage: 'recovery',
                statusMessage: 'Paused after Baddel was closed. Resume when ready.',
                downloadSpeedBps: 0,
                diskUsageBps: 0,
                etaSeconds: null,
                progressSessionId: null,
                processPid: null,
                processStartedAt: null,
                processExitedAt: null,
                recoveryReason: 'interrupted-active-download',
            };
        }
        return task;
    }
}

module.exports = {
    JsonDownloadRepository,
};
