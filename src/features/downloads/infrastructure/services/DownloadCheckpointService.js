'use strict';

const DEFAULT_CHECKPOINT_INTERVAL_MS = 3000;

class DownloadCheckpointService {
    constructor({ writeState, intervalMs = DEFAULT_CHECKPOINT_INTERVAL_MS, clock = Date } = {}) {
        if (typeof writeState !== 'function') throw new Error('DownloadCheckpointService requires writeState');
        this.writeState = writeState;
        this.intervalMs = intervalMs;
        this.clock = clock;
        this.timer = null;
        this.pending = false;
        this.writeQueue = Promise.resolve();
        this.revision = 0;
    }

    schedule(stateProvider) {
        this.pending = true;
        if (this.timer) return;
        this.timer = setTimeout(() => {
            this.timer = null;
            if (!this.pending) return;
            this.flush(stateProvider).catch(() => {});
        }, this.intervalMs);
    }

    async flush(stateProvider) {
        this.pending = false;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        const writeRevision = ++this.revision;
        const state = stateProvider();
        state.updatedAt = new this.clock().toISOString();
        this.writeQueue = this.writeQueue.then(async () => {
            if (writeRevision < this.revision - 1) return state;
            return this.writeState(state);
        }, async () => this.writeState(state));
        return this.writeQueue;
    }

    cancelPending() {
        this.pending = false;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }
}

module.exports = {
    DownloadCheckpointService,
};
