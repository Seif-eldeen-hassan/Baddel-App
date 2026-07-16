'use strict';

const ARTWORK_DOWNLOAD_PRIORITIES = Object.freeze({
    GAME_DETAILS: 'game-details',
    VISIBLE: 'visible',
    PREWARM: 'prewarm',
    BACKGROUND: 'background',
});

const PRIORITY_RANK = Object.freeze({
    [ARTWORK_DOWNLOAD_PRIORITIES.GAME_DETAILS]: 0,
    [ARTWORK_DOWNLOAD_PRIORITIES.VISIBLE]: 1,
    [ARTWORK_DOWNLOAD_PRIORITIES.PREWARM]: 2,
    [ARTWORK_DOWNLOAD_PRIORITIES.BACKGROUND]: 3,
});

function normalizePriority(priority) {
    return Object.prototype.hasOwnProperty.call(PRIORITY_RANK, priority)
        ? priority
        : ARTWORK_DOWNLOAD_PRIORITIES.BACKGROUND;
}

function defaultKeyForTask(task = {}) {
    return [
        task.sourceUrl || task.url || '',
        task.canonicalGameId || '',
        task.type || task.assetType || '',
    ].join('|');
}

class ArtworkDownloadScheduler {
    constructor({
        worker,
        concurrency = 3,
        keyForTask = defaultKeyForTask,
        onEvent = null,
        logger = console,
    } = {}) {
        if (typeof worker !== 'function') throw new Error('ArtworkDownloadScheduler requires a worker function.');
        this._worker = worker;
        this._concurrency = Math.max(1, Number(concurrency) || 1);
        this._keyForTask = keyForTask;
        this._onEvent = typeof onEvent === 'function' ? onEvent : null;
        this._logger = logger;

        this._pending = [];
        this._pendingByKey = new Map();
        this._inFlightByKey = new Map();
        this._active = 0;
        this._sequence = 0;
        this._pumpScheduled = false;
        this._drainWaiters = [];
        this._stats = {
            enqueued: 0,
            started: 0,
            completed: 0,
            failed: 0,
            deduplicated: 0,
            priorityEscalations: 0,
        };
    }

    enqueue(task = {}) {
        const key = String(task.key || this._keyForTask(task) || '').trim();
        if (!key) throw new Error('Artwork download task key is required.');
        const priority = normalizePriority(task.priority);
        const existing = this._pendingByKey.get(key) || this._inFlightByKey.get(key);
        if (existing) {
            this._stats.deduplicated += 1;
            if (this._pendingByKey.has(key) && PRIORITY_RANK[priority] < existing.rank) {
                existing.priority = priority;
                existing.rank = PRIORITY_RANK[priority];
                existing.payload = { ...existing.payload, ...task, key, priority };
                this._stats.priorityEscalations += 1;
                this._sortPending();
                this._emit('priority-escalated', existing);
            } else {
                this._emit('deduplicated', existing);
            }
            return existing.promise;
        }

        let resolveTask;
        let rejectTask;
        const promise = new Promise((resolve, reject) => {
            resolveTask = resolve;
            rejectTask = reject;
        });
        const queued = {
            key,
            priority,
            rank: PRIORITY_RANK[priority],
            sequence: this._sequence++,
            payload: { ...task, key, priority },
            promise,
            resolve: resolveTask,
            reject: rejectTask,
        };

        this._pending.push(queued);
        this._pendingByKey.set(key, queued);
        this._stats.enqueued += 1;
        this._sortPending();
        this._emit('enqueued', queued);
        this._schedulePump();
        return promise;
    }

    drain() {
        if (this._isIdle()) return Promise.resolve(this.getStats());
        return new Promise(resolve => this._drainWaiters.push(resolve));
    }

    getStats() {
        return { ...this._stats };
    }

    getSnapshot() {
        return {
            active: this._active,
            pending: this._pending.map(task => ({
                key: task.key,
                priority: task.priority,
            })),
            stats: this.getStats(),
        };
    }

    _schedulePump() {
        if (this._pumpScheduled) return;
        this._pumpScheduled = true;
        Promise.resolve().then(() => {
            this._pumpScheduled = false;
            this._pump();
        });
    }

    _pump() {
        while (this._active < this._concurrency && this._pending.length) {
            const task = this._pending.shift();
            this._pendingByKey.delete(task.key);
            this._inFlightByKey.set(task.key, task);
            this._active += 1;
            this._stats.started += 1;
            this._emit('started', task);
            Promise.resolve()
                .then(() => this._worker(task.payload))
                .then((result) => {
                    this._stats.completed += 1;
                    task.resolve(result);
                    this._emit('completed', task);
                })
                .catch((err) => {
                    this._stats.failed += 1;
                    task.reject(err);
                    this._emit('failed', task, err);
                })
                .finally(() => {
                    this._active -= 1;
                    this._inFlightByKey.delete(task.key);
                    this._pump();
                    this._resolveDrainIfIdle();
                });
        }
        this._resolveDrainIfIdle();
    }

    _sortPending() {
        this._pending.sort((a, b) => (a.rank - b.rank) || (a.sequence - b.sequence));
    }

    _isIdle() {
        return this._active === 0 && this._pending.length === 0 && !this._pumpScheduled;
    }

    _resolveDrainIfIdle() {
        if (!this._isIdle() || !this._drainWaiters.length) return;
        const stats = this.getStats();
        const waiters = this._drainWaiters.splice(0);
        waiters.forEach(resolve => resolve(stats));
    }

    _emit(event, task, err = null) {
        if (!this._onEvent) return;
        try {
            this._onEvent({
                event,
                key: task.key,
                priority: task.priority,
                error: err?.message || null,
            });
        } catch (emitErr) {
            try { this._logger.warn?.('[ArtworkDownloadScheduler] event handler failed:', emitErr.message); } catch {}
        }
    }
}

module.exports = {
    ArtworkDownloadScheduler,
    ARTWORK_DOWNLOAD_PRIORITIES,
    PRIORITY_RANK,
    defaultKeyForTask,
};
