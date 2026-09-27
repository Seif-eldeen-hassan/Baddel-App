'use strict';

class InstallSizeResolutionCoordinator {
    constructor({ execute, maxConcurrency = 2, maxBackgroundQueue = 8, now = Date.now, retentionMs = 60_000 } = {}) {
        if (typeof execute !== 'function') throw new Error('InstallSizeResolutionCoordinator requires execute');
        this.execute = execute;
        this.maxConcurrency = Math.max(1, Number(maxConcurrency) || 1);
        this.maxBackgroundQueue = Math.max(1, Number(maxBackgroundQueue) || 1);
        this.now = now;
        this.retentionMs = Math.max(0, Number(retentionMs) || 0);
        this.active = 0;
        this.entries = new Map();
        this.foreground = [];
        this.background = [];
    }

    request(key, payload, { priority = 'foreground', onState = null } = {}) {
        const normalizedPriority = priority === 'background' ? 'background' : 'foreground';
        let existing = this.entries.get(key);
        const backgroundResultInvalid = existing?.priority === 'background'
            && !(existing.value?.downloadSizeBytes > 0 && existing.value?.installedDiskSizeBytes > 0 && existing.value?.sizeSource);
        if (existing?.completed && (existing.expiresAt <= this.now()
            || (normalizedPriority === 'foreground' && backgroundResultInvalid))) {
            this.entries.delete(key);
            existing = null;
        }
        if (existing) {
            let promoted = false;
            if (!existing.started && normalizedPriority === 'foreground' && existing.priority === 'background') {
                const index = this.background.indexOf(existing);
                if (index >= 0) this.background.splice(index, 1);
                existing.priority = 'foreground';
                this.foreground.push(existing);
                promoted = true;
            }
            onState?.('coalesced', { priority: normalizedPriority, promoted, running: existing.started });
            this._drain();
            return existing.promise.then(value => ({ value, coalesced: true, promoted }));
        }

        let resolveEntry;
        const entry = {
            key,
            payload,
            priority: normalizedPriority,
            started: false,
            resolve: null,
            promise: new Promise(resolve => { resolveEntry = resolve; }),
            onState,
        };
        entry.resolve = resolveEntry;
        this.entries.set(key, entry);
        (normalizedPriority === 'foreground' ? this.foreground : this.background).push(entry);
        onState?.('queued', { priority: normalizedPriority, active: this.active });
        if (normalizedPriority === 'background') this._trimBackgroundQueue();
        this._drain();
        return entry.promise.then(value => ({ value, coalesced: false, promoted: false }));
    }

    _trimBackgroundQueue() {
        while (this.background.length > this.maxBackgroundQueue) {
            const dropped = this.background.shift();
            if (!dropped || dropped.started) continue;
            this.entries.delete(dropped.key);
            dropped.onState?.('dropped', { reason: 'INSTALL_SIZE_PREFETCH_QUEUE_FULL' });
            dropped.resolve({ sizeReason: 'INSTALL_SIZE_PREFETCH_QUEUE_FULL' });
        }
    }

    _drain() {
        while (this.active < this.maxConcurrency) {
            const entry = this.foreground.shift() || this.background.shift();
            if (!entry) return;
            if (this.entries.get(entry.key) !== entry) continue;
            entry.started = true;
            this.active += 1;
            entry.onState?.('started', { priority: entry.priority, active: this.active });
            Promise.resolve()
                .then(() => this.execute(entry.payload))
                .then(value => {
                    entry.value = value;
                    entry.completed = true;
                    entry.expiresAt = this.now() + this.retentionMs;
                    entry.resolve(value);
                }, error => {
                    const value = { sizeReason: error?.code || 'PROVIDER_SIZE_UNAVAILABLE' };
                    entry.value = value;
                    entry.completed = true;
                    entry.expiresAt = this.now() + this.retentionMs;
                    entry.resolve(value);
                })
                .finally(() => {
                    this.active -= 1;
                    // Retain successful results briefly so an Install click immediately after
                    // prefetch reuses the same completed operation without another provider probe.
                    if (this.entries.size > 100) {
                        for (const [key, value] of this.entries) {
                            if (value.completed && value.expiresAt <= this.now()) this.entries.delete(key);
                        }
                        while (this.entries.size > 100) {
                            const completed = [...this.entries].find(([, value]) => value.completed);
                            if (!completed) break;
                            this.entries.delete(completed[0]);
                        }
                    }
                    this._drain();
                });
        }
    }
}

module.exports = { InstallSizeResolutionCoordinator };
