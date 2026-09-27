'use strict';

const fs = require('fs');
const path = require('path');

const AUTHORITATIVE_SOURCES = new Set(['legendary-info-manifest', 'gogdl-info']);

class InstallSizeCacheRepository {
    constructor({ userDataDir, fsModule = fs, pathModule = path, now = Date.now, ttlMs = 24 * 60 * 60 * 1000 } = {}) {
        if (!userDataDir) throw new Error('InstallSizeCacheRepository requires userDataDir');
        this.fs = fsModule;
        this.path = pathModule;
        this.now = now;
        this.ttlMs = ttlMs;
        this.file = this.path.join(userDataDir, 'downloads', 'install-size-cache-v1.json');
        this.entries = new Map();
        this.loaded = false;
        this.writeQueue = Promise.resolve();
    }

    load() {
        if (this.loaded) return;
        this.loaded = true;
        try {
            const parsed = JSON.parse(this.fs.readFileSync(this.file, 'utf8'));
            for (const [key, entry] of Object.entries(parsed?.entries || {})) this.entries.set(key, entry);
        } catch {}
    }

    get(key) {
        this.load();
        const entry = this.entries.get(String(key));
        if (!entry || entry.expiresAt <= this.now() || !AUTHORITATIVE_SOURCES.has(entry.value?.sizeSource)) {
            if (entry) this.entries.delete(String(key));
            return null;
        }
        return { ...entry.value };
    }

    set(key, value) {
        this.load();
        if (!AUTHORITATIVE_SOURCES.has(value?.sizeSource)) return Promise.resolve(false);
        if (!(value.downloadSizeBytes > 0 && value.installedDiskSizeBytes > 0)) return Promise.resolve(false);
        const now = this.now();
        this.entries.set(String(key), { value: { ...value }, storedAt: now, expiresAt: now + this.ttlMs });
        for (const [entryKey, entry] of this.entries) {
            if (entry.expiresAt <= now) this.entries.delete(entryKey);
        }
        while (this.entries.size > 200) this.entries.delete(this.entries.keys().next().value);
        const snapshot = { version: 1, entries: Object.fromEntries(this.entries) };
        const write = async () => {
            await this.fs.promises.mkdir(this.path.dirname(this.file), { recursive: true });
            await this.fs.promises.writeFile(this.file, JSON.stringify(snapshot, null, 2), 'utf8');
            return true;
        };
        this.writeQueue = this.writeQueue.then(write, write);
        return this.writeQueue;
    }
}

module.exports = { InstallSizeCacheRepository, AUTHORITATIVE_SOURCES };
