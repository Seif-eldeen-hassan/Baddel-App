'use strict';

function deadlineError(timeoutMs) {
    const error = new Error(`Epic price refresh exceeded its ${timeoutMs}ms deadline.`);
    error.code = 'EPIC_PRICE_REFRESH_DEADLINE_EXCEEDED';
    error.failedStage = 'price_refresh_deadline';
    return error;
}

class EpicPriceRefreshOperationRegistry {
    constructor({ setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
        this.setTimer = setTimer;
        this.clearTimer = clearTimer;
        this.operations = new Map();
    }

    run(accountId, { source = 'manual', timeoutMs = 8 * 60 * 1000, onDeadline = null } = {}, task) {
        const key = String(accountId || '');
        const existing = this.operations.get(key);
        if (existing) {
            return existing.promise.then((result) => ({
                ...result,
                joined: true,
                activeSource: existing.source,
            }));
        }

        const controller = new AbortController();
        let timer = null;
        const deadline = new Promise((_, reject) => {
            timer = this.setTimer(() => {
                const error = deadlineError(timeoutMs);
                controller.abort(error);
                try { onDeadline?.(error, { accountId: key, source }); } catch {}
                reject(error);
            }, Math.max(1, Number(timeoutMs) || 1));
            timer?.unref?.();
        });
        const work = Promise.resolve().then(() => task({ signal: controller.signal, source }));
        const promise = Promise.race([work, deadline]).finally(() => {
            if (timer) this.clearTimer(timer);
            if (this.operations.get(key)?.promise === promise) this.operations.delete(key);
        });
        this.operations.set(key, { promise, source, controller });
        return promise;
    }

    get(accountId) {
        const operation = this.operations.get(String(accountId || ''));
        return operation ? { source: operation.source, active: true } : null;
    }
}

module.exports = { EpicPriceRefreshOperationRegistry, deadlineError };
