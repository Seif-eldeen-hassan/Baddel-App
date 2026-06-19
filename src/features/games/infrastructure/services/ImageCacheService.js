'use strict';

// ─── ImageCacheService ────────────────────────────────────────────────────────
//
// Owns all image-cache filesystem operations: looking up a cached image file
// (findInCache) and deleting all cached images for a game (deleteGameImages).
//
// Extracted from BaddelEngine (gameScanner.js).  BaddelEngine keeps thin
// wrapper methods that delegate here, so all existing call sites are unchanged.
//
// Dependencies are injected so the service is fully testable without Electron.
//
// What this class does NOT do:
//   • Modify games-db.json — DB ownership stays in JsonGameRepository
//   • Call Electron APIs — dbFolder is a plain string provided by the caller
//   • Download images — that is handled by baddelApi / backgroundDownload

class ImageCacheService {
    /**
     * @param {{
     *   fs:       typeof import('fs'),  // full fs module (sync methods used)
     *   path:     typeof import('path'),
     *   dbFolder: string,               // absolute path to userData directory
     * }} deps
     */
    constructor({ fs, path, dbFolder }) {
        this._fs       = fs;
        this._path     = path;
        this._dbFolder = dbFolder;
    }

    // Prefix used for all cached image files: "${type}_${gameId}"
    _cacheBaseName(type, gameId) {
        return `${type}_${String(gameId)}`;
    }

    _cacheDir() {
        return this._path.join(this._dbFolder, 'image_cache');
    }

    /**
     * Returns the file:// URL of the first cached image file whose name starts
     * with the type+gameId prefix, or null if none exists.
     *
     * Mirrors the legacy BaddelEngine.findInCache behavior exactly.
     *
     * @param   {string} gameId
     * @param   {'cover'|'hero'|'logo'} type
     * @returns {string|null}
     */
    findInCache(gameId, type) {
        try {
            const cacheDir = this._cacheDir();
            if (!this._fs.existsSync(cacheDir)) return null;
            const files = this._fs.readdirSync(cacheDir);
            const prefix = this._cacheBaseName(type, gameId);
            const found = files.find(f => f.startsWith(prefix));
            return found
                ? `file://${this._path.join(cacheDir, found).replace(/\\/g, '/')}`
                : null;
        } catch { return null; }
    }

    /**
     * Deletes all cached cover/hero/logo files for the given gameId.
     * Silences all errors (missing directory, unlink failures).
     *
     * Mirrors the legacy BaddelEngine.deleteGameImages behavior exactly.
     *
     * @param {string} gameId
     * @returns {void}
     */
    deleteGameImages(gameId) {
        try {
            const cacheDir = this._cacheDir();
            const files = this._fs.readdirSync(cacheDir);
            ['cover', 'hero', 'logo'].forEach(type => {
                const prefix = this._cacheBaseName(type, gameId);
                files.filter(f => f.startsWith(prefix)).forEach(file => {
                    try { this._fs.unlinkSync(this._path.join(cacheDir, file)); } catch { /* ignore */ }
                });
            });
        } catch { /* ignore */ }
    }
}

module.exports = { ImageCacheService };
