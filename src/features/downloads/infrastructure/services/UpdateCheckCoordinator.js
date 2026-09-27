'use strict';

const UPDATE_CHECK_CONCURRENCY = 2;
const PRIORITY = Object.freeze({ background: 0, manual: 1 });

class UpdateCheckCoordinator {
    constructor({ concurrency = UPDATE_CHECK_CONCURRENCY, onStateChange = null } = {}) {
        this.concurrency = Math.max(1, Math.min(2, Number(concurrency) || UPDATE_CHECK_CONCURRENCY));
        this.onStateChange = onStateChange;
        this.activeCount = 0;
        this.sequence = 0;
        this.pending = [];
        this.byIdentity = new Map();
    }

    request({ identity, priority = 'manual', run } = {}) {
        const key = String(identity || '').trim();
        if (!key) throw new Error('UpdateCheckCoordinator requires an immutable identity');
        if (typeof run !== 'function') throw new Error('UpdateCheckCoordinator requires a provider comparison');
        const requestedPriority = priority === 'background' ? 'background' : 'manual';
        const existing = this.byIdentity.get(key);
        if (existing) {
            if (existing.state === 'queued' && PRIORITY[requestedPriority] > PRIORITY[existing.priority]) {
                existing.priority = requestedPriority;
                this.sortPending();
                this.notify();
            }
            return existing.promise;
        }

        let resolveRequest;
        let rejectRequest;
        const promise = new Promise((resolve, reject) => {
            resolveRequest = resolve;
            rejectRequest = reject;
        });
        const entry = {
            identity: key,
            priority: requestedPriority,
            sequence: this.sequence++,
            state: 'queued',
            run,
            promise,
            resolve: resolveRequest,
            reject: rejectRequest,
        };
        this.byIdentity.set(key, entry);
        this.pending.push(entry);
        this.sortPending();
        this.notify();
        this.drain();
        return promise;
    }

    sortPending() {
        this.pending.sort((a, b) => PRIORITY[b.priority] - PRIORITY[a.priority] || a.sequence - b.sequence);
    }

    drain() {
        while (this.activeCount < this.concurrency && this.pending.length > 0) {
            const entry = this.pending.shift();
            entry.state = 'running';
            this.activeCount += 1;
            this.notify();
            Promise.resolve().then(entry.run).then(result => {
                this.activeCount -= 1;
                this.byIdentity.delete(entry.identity);
                this.notify();
                this.drain();
                entry.resolve(result);
            }, error => {
                this.activeCount -= 1;
                this.byIdentity.delete(entry.identity);
                this.notify();
                this.drain();
                entry.reject(error);
            });
        }
    }

    get(identity) {
        const entry = this.byIdentity.get(String(identity || ''));
        return entry ? { identity: entry.identity, priority: entry.priority, state: entry.state } : null;
    }

    has(identity) {
        return this.byIdentity.has(String(identity || ''));
    }

    getPromise(identity) {
        return this.byIdentity.get(String(identity || ''))?.promise || null;
    }

    getSnapshot() {
        return {
            concurrency: this.concurrency,
            activeCount: this.activeCount,
            pendingCount: this.pending.length,
            checks: [...this.byIdentity.values()].map(entry => ({
                identity: entry.identity,
                priority: entry.priority,
                state: entry.state,
            })),
        };
    }

    notify() {
        this.onStateChange?.(this.getSnapshot());
    }
}

module.exports = { UpdateCheckCoordinator, UPDATE_CHECK_CONCURRENCY };
