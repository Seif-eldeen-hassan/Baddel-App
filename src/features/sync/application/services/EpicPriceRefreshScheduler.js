'use strict';

const DAY_MS = 24 * 60 * 60 * 1000;

function isEpicPriceRefreshDue(lastRefreshedAt, nowMs = Date.now(), intervalMs = DAY_MS) {
    const timestamp = Date.parse(String(lastRefreshedAt || ''));
    return !Number.isFinite(timestamp) || nowMs - timestamp >= intervalMs;
}

class EpicPriceRefreshScheduler {
    constructor({
        listAccounts,
        refreshAccount,
        nowMs = () => Date.now(),
        intervalMs = DAY_MS,
        checkEveryMs = 5 * 60 * 1000,
        initialDelayMs = 90 * 1000,
        failureBackoffBaseMs = 15 * 60 * 1000,
        failureBackoffMaxMs = 6 * 60 * 60 * 1000,
        logger = console,
    } = {}) {
        if (typeof listAccounts !== 'function' || typeof refreshAccount !== 'function') {
            throw new Error('EpicPriceRefreshScheduler requires account and refresh functions.');
        }
        this.listAccounts = listAccounts;
        this.refreshAccount = refreshAccount;
        this.nowMs = nowMs;
        this.intervalMs = Math.max(1000, Number(intervalMs) || DAY_MS);
        this.checkEveryMs = Math.max(1000, Number(checkEveryMs) || 5 * 60 * 1000);
        this.initialDelayMs = Math.max(0, Number(initialDelayMs) || 0);
        this.failureBackoffBaseMs = Math.max(1000, Number(failureBackoffBaseMs) || 15 * 60 * 1000);
        this.failureBackoffMaxMs = Math.max(this.failureBackoffBaseMs, Number(failureBackoffMaxMs) || 6 * 60 * 60 * 1000);
        this.logger = logger;
        this.initialTimer = null;
        this.intervalTimer = null;
        this.running = null;
        this.failures = new Map();
    }

    start() {
        if (this.initialTimer || this.intervalTimer) return;
        this.initialTimer = setTimeout(() => {
            this.initialTimer = null;
            this.tick().catch((error) => this.logger.warn?.('[Epic Prices] Scheduled check failed:', error?.message || error));
            this.intervalTimer = setInterval(() => {
                this.tick().catch((error) => this.logger.warn?.('[Epic Prices] Scheduled check failed:', error?.message || error));
            }, this.checkEveryMs);
            this.intervalTimer.unref?.();
        }, this.initialDelayMs);
        this.initialTimer.unref?.();
    }

    stop() {
        if (this.initialTimer) clearTimeout(this.initialTimer);
        if (this.intervalTimer) clearInterval(this.intervalTimer);
        this.initialTimer = null;
        this.intervalTimer = null;
    }

    async tick() {
        if (this.running) return this.running;
        this.running = this._runTick();
        try {
            return await this.running;
        } finally {
            this.running = null;
        }
    }

    async _runTick() {
        const accounts = await this.listAccounts();
        const now = this.nowMs();
        const due = (Array.isArray(accounts) ? accounts : []).filter((account) => {
            if (!account?.accountId || Number(account.totalGames || 0) <= 0) return false;
            if (!isEpicPriceRefreshDue(account.pricesFetchedAt, now, this.intervalMs)) return false;
            const failure = this.failures.get(String(account.accountId));
            return !failure || Number(failure.nextRetryAt || 0) <= now;
        });
        const results = [];
        for (const account of due) {
            const accountId = String(account.accountId);
            try {
                const result = await this.refreshAccount(accountId, { source: 'automatic' });
                if (!result || result.status === 'error') {
                    const error = new Error(result?.message || 'Automatic Epic price refresh failed.');
                    error.code = result?.code || 'EPIC_PRICE_REFRESH_FAILED';
                    throw error;
                }
                this.failures.delete(accountId);
                results.push(result);
            } catch (error) {
                this.logger.warn?.('[Epic Prices] Automatic refresh deferred:', error?.code || error?.message || error);
                const previous = this.failures.get(accountId);
                const attempts = Number(previous?.attempts || 0) + 1;
                const delayMs = Math.min(this.failureBackoffMaxMs, this.failureBackoffBaseMs * (2 ** Math.max(0, attempts - 1)));
                this.failures.set(accountId, { attempts, lastAttemptAt: now, nextRetryAt: now + delayMs, code: error?.code || 'EPIC_PRICE_REFRESH_FAILED' });
                results.push({ status: 'error', code: error?.code || 'EPIC_PRICE_REFRESH_FAILED' });
            }
        }
        return { checked: Array.isArray(accounts) ? accounts.length : 0, due: due.length, results };
    }

    getRuntimeState(accountId) {
        const state = this.failures.get(String(accountId));
        return state ? { ...state } : null;
    }
}

module.exports = { DAY_MS, isEpicPriceRefreshDue, EpicPriceRefreshScheduler };
