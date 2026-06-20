'use strict';

// ─── MetadataCacheStore ───────────────────────────────────────────────────────
//
// Owns persistence of the full structured metadata fallback cache
// (metadata-cache.json), separate from games-db.json.
//
// Keyed by game.id; stores rich fields (description, screenshots, ratings,
// trailers, etc.) fetched from the Baddel metadata server or local resolver.
// Canonicalizes Steam IDs so steam-860510 and steam_860510 share one entry.
//
// Extracted from gameScanner.js (BaddelEngine).  The singleton instance
// remains in gameScanner.js; this file exports only the class.
//
// What this class does NOT do:
//   • Touch games-db.json — that is JsonGameRepository's responsibility
//   • Touch image cache files — that is ImageCacheService's responsibility
//   • Import Electron, IPC, scan logic, or analytics

const fs   = require('fs').promises;
const path = require('path');

// ── Private helpers ───────────────────────────────────────────────────────────

function normalizeMetadataCacheKey(gameId) {
    const raw = String(gameId || '').trim();

    // Steam installed sometimes uses steam-APPID,
    // All Games sometimes uses steam_APPID.
    // Force both to one canonical cache key.
    const steam = raw.match(/^steam[-_](\d+)$/i);
    if (steam) return `steam_${steam[1]}`;

    return raw;
}

function metadataCacheAliases(gameId) {
    const raw = String(gameId || '').trim();
    const keys = new Set();

    if (raw) keys.add(raw);

    const canonical = normalizeMetadataCacheKey(raw);
    if (canonical) keys.add(canonical);

    const steam = raw.match(/^steam[-_](\d+)$/i);
    if (steam) {
        keys.add(`steam-${steam[1]}`);
        keys.add(`steam_${steam[1]}`);
    }

    return [...keys].filter(Boolean);
}

function isHollowMetadata(meta) {
    if (!meta || typeof meta !== 'object') return true;

    const info = meta.info || {};
    const screenshots = Array.isArray(info.screenshots) ? info.screenshots : [];
    const trailers = Array.isArray(info.allTrailers) ? info.allTrailers : [];
    const genres = Array.isArray(info.genres) ? info.genres : [];
    const ratingSources = Array.isArray(meta?.quality?.sources?.ratings)
        ? meta.quality.sources.ratings
        : Array.isArray(meta?.ratings?.sources)
            ? meta.ratings.sources
            : [];

    return !(
        info.description ||
        meta.description ||
        info.short_description ||
        meta.short_description ||
        meta.quality?.sources?.text ||
        screenshots.length ||
        trailers.length ||
        genres.length ||
        ratingSources.length
    );
}

// ── MetadataCacheStore ────────────────────────────────────────────────────────

class MetadataCacheStore {
    constructor(dbFolder) {
        this.cachePath = path.join(dbFolder, 'metadata-cache.json');
        this._cache = null; // loaded lazily
    }

    async _load() {
        if (this._cache !== null) return;
        try {
            const raw = await fs.readFile(this.cachePath, 'utf8');
            this._cache = JSON.parse(raw);
        } catch {
            this._cache = {};
        }
    }

    async _flush() {
        try {
            await fs.writeFile(this.cachePath, JSON.stringify(this._cache, null, 2), 'utf8');
        } catch (err) {
            console.warn('[MetadataCacheStore] flush error:', err.message);
        }
    }

    async save(gameId, title, platform, meta) {
        await this._load();

        const key = normalizeMetadataCacheKey(gameId);

        this._cache[key] = {
            gameId: key,
            originalGameId: String(gameId || ''),
            title: title || null,
            platform: platform || null,
            fetchedAt: Date.now(),
            source: 'fallback-getMetadata',
            meta,
        };

        // Remove old duplicate aliases like steam-860510
        // so the app cannot read the wrong/hollow cache later.
        for (const alias of metadataCacheAliases(gameId)) {
            if (alias !== key && this._cache[alias]) {
                delete this._cache[alias];
                console.log(`[MetadataCacheStore] Removed duplicate alias cache key=${alias}; canonical=${key}`);
            }
        }

        await this._flush();

        console.log(`[MetadataCacheStore] Persisted fallback metadata for gameId=${key} ("${title}")`);
        return { status: 'success' };
    }

    async load(gameId) {
        await this._load();

        const canonicalKey = normalizeMetadataCacheKey(gameId);
        const aliases = metadataCacheAliases(gameId);

        for (const key of [canonicalKey, ...aliases.filter(k => k !== canonicalKey)]) {
            const entry = this._cache[key] || null;
            if (!entry) continue;

            const meta = entry.meta || null;

            // If the found entry is hollow/empty, delete it and keep searching aliases.
            if (isHollowMetadata(meta)) {
                console.warn(`[MetadataCacheStore] Ignoring hollow cached metadata for gameId=${key} ("${entry.title || ''}")`);
                delete this._cache[key];
                await this._flush();
                continue;
            }

            // If found under old key steam-xxxx, migrate it to steam_xxxx.
            if (key !== canonicalKey) {
                this._cache[canonicalKey] = {
                    ...entry,
                    gameId: canonicalKey,
                    originalGameId: entry.originalGameId || String(gameId || ''),
                };

                delete this._cache[key];
                await this._flush();

                console.log(`[MetadataCacheStore] Migrated metadata cache ${key} -> ${canonicalKey}`);
            }

            console.log(
                `[MetadataCacheStore] Loaded cached fallback metadata for gameId=${canonicalKey} ` +
                `("${entry.title}") fetchedAt=${new Date(entry.fetchedAt || Date.now()).toISOString()}`
            );

            return meta;
        }

        return null;
    }

    // Returns the full entry with title, fetchedAt, etc. — used by main.js
    async getEntry(gameId) {
        await this._load();

        const canonicalKey = normalizeMetadataCacheKey(gameId);
        const aliases = metadataCacheAliases(gameId);

        for (const key of [canonicalKey, ...aliases.filter(k => k !== canonicalKey)]) {
            const entry = this._cache[key] || null;
            if (!entry) continue;

            if (isHollowMetadata(entry.meta)) {
                delete this._cache[key];
                await this._flush();
                continue;
            }

            if (key !== canonicalKey) {
                this._cache[canonicalKey] = {
                    ...entry,
                    gameId: canonicalKey,
                    originalGameId: entry.originalGameId || String(gameId || ''),
                };

                delete this._cache[key];
                await this._flush();
            }

            return this._cache[canonicalKey];
        }

        return null;
    }

    // Check if we already have a non-stale entry.
    async hasEntry(gameId, maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
        const entry = await this.getEntry(gameId);
        if (!entry) return false;
        return (Date.now() - (entry.fetchedAt || 0)) < maxAgeMs;
    }

    // Remove stale/incomplete entry and all aliases.
    async deleteEntry(gameId) {
        await this._load();

        let changed = false;

        for (const key of metadataCacheAliases(gameId)) {
            if (this._cache[key]) {
                delete this._cache[key];
                changed = true;
                console.log(`[MetadataCacheStore] Deleted metadata cache key=${key}`);
            }
        }

        if (changed) await this._flush();
    }
}

module.exports = { MetadataCacheStore };
