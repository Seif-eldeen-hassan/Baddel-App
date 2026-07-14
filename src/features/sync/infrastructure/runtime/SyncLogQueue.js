'use strict';

class SyncLogQueue {
    constructor({
        writeLog,
        now,
    } = {}) {
        this.writeLog = typeof writeLog === 'function' ? writeLog : async () => {};
        this.now = typeof now === 'function' ? now : () => new Date().toISOString();
        this.writeQueues = {};
    }

    push(queueKey, entry = {}) {
        const key = String(queueKey || 'default');
        const logEntry = {
            timestamp: entry.timestamp || this.now(),
            level: entry.level,
            message: entry.message,
            accountId: entry.accountId || null,
            accountName: entry.accountName || null,
        };

        const currentQueue = this.writeQueues[key] || Promise.resolve();
        this.writeQueues[key] = currentQueue
            .then(() => this.writeLog(logEntry, key))
            .catch(() => {});

        return logEntry;
    }
}

module.exports = {
    SyncLogQueue,
};
