'use strict';

class EpicEnrichmentScheduler {
    constructor({ globalConcurrency = 2, perAccountConcurrency = 2 } = {}) {
        this.globalConcurrency = Math.max(1, Number(globalConcurrency) || 2);
        this.perAccountConcurrency = Math.max(1, Math.min(2, Number(perAccountConcurrency) || 2));
        this.queue = [];
        this.running = new Map();
        this.jobs = new Map();
        this.activeAccounts = new Map();
        this.closed = false;
    }

    schedule({ accountId, revision, phase, task }) {
        if (this.closed) return Promise.reject(this._cancelledError());
        const id = String(accountId);
        const key = `${id}:${Number(revision)}:${String(phase)}`;
        if (this.jobs.has(key)) return this.jobs.get(key).promise;
        const controller = new AbortController();
        let resolve;
        let reject;
        const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
        const job = { key, accountId: id, phase, task, controller, promise, resolve, reject };
        this.jobs.set(key, job);
        this.queue.push(job);
        this._drain();
        return promise;
    }

    cancelAccount(accountId, message = 'Epic enrichment cancelled.') {
        const id = String(accountId);
        const error = this._cancelledError(message);
        for (const job of this.queue.filter((item) => item.accountId === id)) {
            job.controller.abort(error);
            job.reject(error);
            this.jobs.delete(job.key);
        }
        this.queue = this.queue.filter((item) => item.accountId !== id);
        for (const job of this.running.values()) if (job.accountId === id) job.controller.abort(error);
    }

    shutdown() {
        this.closed = true;
        for (const id of new Set([...this.queue, ...this.running.values()].map((job) => job.accountId))) {
            this.cancelAccount(id, 'Epic enrichment stopped because the app is closing.');
        }
    }

    getDiagnostics() {
        return {
            globalConcurrency: this.globalConcurrency,
            perAccountConcurrency: this.perAccountConcurrency,
            active: this.running.size,
            queued: this.queue.length,
            activeAccounts: Object.fromEntries(this.activeAccounts),
        };
    }

    _drain() {
        while (!this.closed && this.running.size < this.globalConcurrency) {
            const index = this.queue.findIndex((job) => Number(this.activeAccounts.get(job.accountId) || 0) < this.perAccountConcurrency);
            if (index < 0) return;
            const [job] = this.queue.splice(index, 1);
            if (job.controller.signal.aborted) continue;
            this.running.set(job.key, job);
            this.activeAccounts.set(job.accountId, Number(this.activeAccounts.get(job.accountId) || 0) + 1);
            Promise.resolve().then(() => job.task({ signal: job.controller.signal })).then(job.resolve, job.reject).finally(() => {
                this.running.delete(job.key);
                const nextActive = Number(this.activeAccounts.get(job.accountId) || 1) - 1;
                if (nextActive > 0) this.activeAccounts.set(job.accountId, nextActive);
                else this.activeAccounts.delete(job.accountId);
                this.jobs.delete(job.key);
                this._drain();
            });
        }
    }

    _cancelledError(message = 'Epic enrichment cancelled.') {
        const error = new Error(message);
        error.code = 'EPIC_SYNC_CANCELLED';
        return error;
    }
}

module.exports = { EpicEnrichmentScheduler };
