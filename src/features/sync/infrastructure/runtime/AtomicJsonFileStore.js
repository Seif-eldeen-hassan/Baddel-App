'use strict';

const defaultFs = require('fs').promises;
const defaultPath = require('path');
const defaultCrypto = require('crypto');
const { performance } = require('perf_hooks');

const queues = new Map();

function normalizeFileKey(filePath, path = defaultPath) {
    return path.resolve(String(filePath || ''));
}

function enqueueFileWrite(filePath, task, path = defaultPath) {
    const key = normalizeFileKey(filePath, path).toLowerCase();
    const previous = queues.get(key) || Promise.resolve();
    const next = previous.then(task, task);
    queues.set(key, next.catch(() => {}));
    return next;
}

function isTransientReplaceError(err) {
    return err && ['EPERM', 'EBUSY', 'EACCES'].includes(err.code);
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

class AtomicJsonFileStore {
    constructor({ fs = defaultFs, path = defaultPath, crypto = defaultCrypto } = {}) {
        this.fs = fs;
        this.path = path;
        this.crypto = crypto;
    }


    async _replaceFile(tmp, filePath) {
        const delays = [0, 15, 40, 90, 180];
        let lastError = null;
        for (let attempt = 0; attempt < delays.length; attempt += 1) {
            if (delays[attempt] > 0) await sleep(delays[attempt]);
            try {
                await this.fs.rename(tmp, filePath);
                return;
            } catch (err) {
                lastError = err;
                if (!isTransientReplaceError(err)) throw err;
            }
        }

        try {
            await this.fs.unlink(filePath);
        } catch (err) {
            if (err?.code !== 'ENOENT') {
                if (!isTransientReplaceError(err)) throw err;
                await sleep(180);
                try { await this.fs.unlink(filePath); } catch (retryErr) {
                    if (retryErr?.code !== 'ENOENT') throw retryErr;
                }
            }
        }

        try {
            await this.fs.rename(tmp, filePath);
        } catch (err) {
            if (isTransientReplaceError(err) && lastError) {
                err.cause = lastError;
            }
            throw err;
        }
    }

    async writeJson(filePath, value) {
        return enqueueFileWrite(filePath, async () => {
            const totalStart = performance.now();
            const timings = {
                stringifyMs: 0,
                mkdirMs: 0,
                openMs: 0,
                writeMs: 0,
                syncMs: 0,
                closeMs: 0,
                renameMs: 0,
                totalMs: 0,
                bytes: 0,
            };
            const dir = this.path.dirname(filePath);
            let stageStart = performance.now();
            await this.fs.mkdir(dir, { recursive: true });
            timings.mkdirMs = performance.now() - stageStart;
            const unique = String(process.pid) + "." + String(Date.now()) + "." + this.crypto.randomBytes(6).toString("hex");
            const tmp = this.path.join(dir, "." + this.path.basename(filePath) + "." + unique + ".tmp");
            stageStart = performance.now();
            const data = JSON.stringify(value, null, 2);
            timings.stringifyMs = performance.now() - stageStart;
            timings.bytes = Buffer.byteLength(data, "utf8");
            let handle = null;
            try {
                stageStart = performance.now();
                handle = await this.fs.open(tmp, "w");
                timings.openMs = performance.now() - stageStart;
                stageStart = performance.now();
                await handle.writeFile(data, "utf8");
                timings.writeMs = performance.now() - stageStart;
                stageStart = performance.now();
                await handle.sync();
                timings.syncMs = performance.now() - stageStart;
                stageStart = performance.now();
                await handle.close();
                timings.closeMs = performance.now() - stageStart;
                handle = null;
                stageStart = performance.now();
                await this._replaceFile(tmp, filePath);
                timings.renameMs = performance.now() - stageStart;
                timings.totalMs = performance.now() - totalStart;
                return timings;
            } catch (err) {
                if (handle) {
                    try { await handle.close(); } catch {}
                }
                try { await this.fs.unlink(tmp); } catch {}
                throw err;
            }
        }, this.path);
    }
}

module.exports = {
    AtomicJsonFileStore,
    enqueueFileWrite,
};
