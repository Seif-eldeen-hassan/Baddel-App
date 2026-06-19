'use strict';

// ─── JsonGameRepository ───────────────────────────────────────────────────────
//
// Passive DB persistence layer extracted from BaddelEngine (gameScanner.js).
// Owns the games-db.json file and all low-risk CRUD operations on it.
//
// What this class does:
//   • Load / save games-db.json (debounced async write, immediate flush)
//   • _migrateLnkRecords — one-time in-place migration run at init
//   • generateStableId — deterministic MD5 game ID (identical to BaddelEngine)
//   • Read queries: getStoredGames / getSavedGames / getHiddenGames
//   • Mutations: renameGame, removeGame, unhideAllGames, restoreSpecificGames,
//                reorderLibrary
//
// What this class does NOT do:
//   • deleteGamePermanently (cross-cutting: images, mrm, metadata cache)
//   • Scan / upsert / metadata / image / playtime operations
//   • Import Electron, IPC, analytics, or mainWindow
//
// All dependencies are injected so the class is fully testable without Electron.
//
// Behavior is IDENTICAL to BaddelEngine's DB section — no logic was changed,
// only the module boundary moved.

class JsonGameRepository {
    /**
     * @param {{
     *   fs:           typeof import('fs'),   // full fs module (sync + .promises)
     *   path:         typeof import('path'),
     *   crypto:       typeof import('crypto'),
     *   databasePath: string,                 // absolute path to games-db.json
     *   logger?:      Console,
     * }} deps
     */
    constructor({ fs, path, crypto, databasePath, logger = console }) {
        this._fs       = fs;
        this._path     = path;
        this._crypto   = crypto;
        this._dbPath   = databasePath;
        this._dbFolder = path.dirname(databasePath);
        this._log      = logger;
        this._dbCache  = [];
        this._saveTimer = null;

        this.initDatabase();
    }

    // ─── Init / load / persist ────────────────────────────────────────────────

    initDatabase() {
        try {
            if (!this._fs.existsSync(this._dbFolder)) {
                this._fs.mkdirSync(this._dbFolder, { recursive: true });
            }
            if (!this._fs.existsSync(this._dbPath)) {
                this._fs.writeFileSync(this._dbPath, '[]', 'utf8');
            }
            const raw = this._fs.readFileSync(this._dbPath, 'utf8');
            try {
                this._dbCache = JSON.parse(raw);
            } catch {
                this._log.error('[DB] Corrupted — resetting.');
                this._dbCache = [];
                this.saveDatabase();
            }
        } catch (err) {
            this._log.error('[DB] Init error:', err);
            this._dbCache = [];
        }
        this._migrateLnkRecords();
    }

    // Fix manual .lnk records written by the broken patch that stored the
    // .lnk path as game.path instead of the real install directory.
    _migrateLnkRecords() {
        let changed = false;
        for (const game of this._dbCache) {
            const isManual = game.scannerPlatform === 'manual' || game.platform === 'Manual';
            const cmdIsLnk = (game.command || '').toLowerCase().endsWith('.lnk');
            if (!isManual || !cmdIsLnk || !game.executablePath) continue;

            const expectedPath = this._path.dirname(game.executablePath);
            if (game.path !== expectedPath) {
                game.path = expectedPath;
                changed = true;
            }
            if (!game.shortcutPath) {
                game.shortcutPath = game.command;
                changed = true;
            }
            const expectedFolder = this._path.basename(this._path.dirname(game.executablePath));
            if (!game.folderName || game.folderName !== expectedFolder) {
                game.folderName = expectedFolder;
                changed = true;
            }
            const expectedExeName = this._path.parse(game.executablePath).name;
            if (!game.exeName || game.exeName !== expectedExeName) {
                game.exeName = expectedExeName;
                changed = true;
            }
        }
        if (changed) {
            this._log.log('[DB] Migrated broken .lnk records to use install directory as path.');
            this.saveDatabase();
        }
    }

    // Immediate async write — cancels any pending debounced save first.
    // Matches BaddelEngine.flushDatabase() exactly.
    async flushDatabase() {
        if (this._saveTimer) {
            clearTimeout(this._saveTimer);
            this._saveTimer = null;
        }
        try {
            const data = JSON.stringify(this._dbCache, null, 2);
            await this._fs.promises.writeFile(this._dbPath, data, 'utf8');
        } catch (err) {
            this._log.error('[DB] Save failed:', err);
            try {
                const backup = this._path.join(
                    this._path.dirname(this._dbPath),
                    'games-db-backup.json'
                );
                await this._fs.promises.writeFile(
                    backup,
                    JSON.stringify(this._dbCache, null, 2),
                    'utf8'
                );
            } catch (backupErr) {
                this._log.error('[DB] Backup also failed:', backupErr);
            }
        }
    }

    // Debounced 500 ms async write — matches BaddelEngine.saveDatabase() exactly.
    saveDatabase() {
        if (this._saveTimer) clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(async () => {
            this._saveTimer = null;
            await this.flushDatabase();
        }, 500);
    }

    // ─── ID generation ────────────────────────────────────────────────────────

    /**
     * Deterministic 16-char hex ID.  Identical to BaddelEngine.generateStableId.
     *
     * @param   {{ command?: string, name?: string }} game
     * @returns {string}
     */
    generateStableId(game) {
        const str = (game.command || game.name).toLowerCase().replace(/"/g, '').trim();
        return this._crypto.createHash('md5').update(str).digest('hex').substring(0, 16);
    }

    // ─── Read queries ─────────────────────────────────────────────────────────

    /** Non-hidden, installed (or unknown install status) games. */
    getStoredGames() {
        return this._dbCache.filter(g => !g.isHidden && g.isInstalled !== false);
    }

    /** Alias — matches the module.exports name used by main.js. */
    getSavedGames() {
        return this.getStoredGames();
    }

    getHiddenGames() {
        return this._dbCache.filter(g => g.isHidden);
    }

    getMissingInstalledGames() {
        return this._dbCache.filter(g => g.installSource === 'scanner' && g.isInstalled === false);
    }

    // ─── Image mutations ──────────────────────────────────────────────────────

    async updateGameMetadata(gameId, metadata, { source = 'server', force = false } = {}) {
        const index = this._dbCache.findIndex(g => String(g.id) === String(gameId));
        if (index === -1) return { status: 'error', message: 'Game not found' };
        const game = this._dbCache[index];

        const artLocked      = game.customArtworkLocked === true;
        const serverVerified = game.artworkSource === 'server-details' && !!game.artworkUpdatedAt;

        const skipArt = !force && (
            (artLocked && source !== 'creator') ||
            (serverVerified && !artLocked && (source === 'pipeline' || source === 'addManual'))
        );

        if (skipArt) {
            this._log.log(`[updateGameMetadata] ${gameId}: skipping art overwrite (artLocked=${artLocked} serverVerified=${serverVerified}, source=${source})`);
        } else {
            const hasHeroKey  = ('hero' in metadata) || ('heroImage' in metadata);
            const hasCoverKey = ('cover' in metadata);

            if ('name' in metadata) {
                const nextName = String(metadata.name || '').trim();
                if (nextName) {
                    game.name = nextName;
                }
            }

            const hero = metadata.hero || metadata.heroImage || null;
            const isCreator = source === 'creator';

            if (hasHeroKey) {
                if (hero) {
                    if (isCreator && !game.creatorOriginalHero) {
                        game.creatorOriginalHero = game.defaultHero || game.heroImage || null;
                    }
                    game.heroImage = hero;
                    if (!isCreator) {
                        game.defaultHero = hero;
                    }
                } else if (isCreator || force) {
                    game.heroImage = game.creatorOriginalHero || game.defaultHero || null;
                }
            }

            if (hasCoverKey) {
                if (metadata.cover) {
                    if (isCreator && !game.creatorOriginalCover) {
                        game.creatorOriginalCover = game.defaultImage || game.image || null;
                    }
                    game.image = metadata.cover;
                    if (!isCreator) {
                        game.defaultImage = metadata.cover;
                    }
                } else if (isCreator || force) {
                    game.image = game.creatorOriginalCover || game.defaultImage || null;
                }
            }

            if ('logo' in metadata) {
                if (metadata.logo) {
                    if (isCreator && !game.creatorOriginalLogo) {
                        game.creatorOriginalLogo = game.defaultLogo || game.logo || null;
                    }
                    game.logo = metadata.logo;
                    if (!isCreator) {
                        game.defaultLogo = metadata.logo;
                    }
                } else if (isCreator || force) {
                    if (metadata.logo === null) {
                        game.logo        = null;
                        game.defaultLogo = null;
                    } else {
                        game.logo = game.creatorOriginalLogo || game.defaultLogo || null;
                    }
                }
            }
        }

        // Provenance fields — always applied regardless of art-lock
        if (metadata.customArtworkLocked !== undefined) {
            game.customArtworkLocked = !!metadata.customArtworkLocked;
        }
        if (metadata.artworkSource !== undefined) {
            game.artworkSource = metadata.artworkSource;
        }
        if (metadata.artworkUpdatedAt !== undefined) {
            game.artworkUpdatedAt = metadata.artworkUpdatedAt;
        }
        if (metadata.clearCreatorOriginals === true) {
            delete game.creatorOriginalCover;
            delete game.creatorOriginalHero;
            delete game.creatorOriginalLogo;
        }
        if (metadata.name !== undefined) {
            const nextName = String(metadata.name || '').trim();
            if (nextName) {
                game.name  = nextName;
                game.title = nextName;
            }
        }

        this.saveDatabase();
        return { status: 'success' };
    }

    updateGameImage(gameId, newImagePath, type = 'cover') {
        const index = this._dbCache.findIndex(g => String(g.id) === String(gameId));
        if (index === -1) return { status: 'error', message: 'Game not found' };

        const game = this._dbCache[index];

        let finalPath = newImagePath;
        if (finalPath && !finalPath.startsWith('http') && !finalPath.startsWith('file://')) {
            finalPath = `file://${finalPath}`;
        }

        if (type === 'hero') {
            game.heroImage = finalPath;
        } else if (type === 'logo') {
            game.logo = finalPath;
        } else {
            game.image = finalPath;
        }

        game.customArtworkLocked = true;
        game.artworkSource = 'creator';
        game.artworkUpdatedAt = Date.now();

        this.saveDatabase();
        return {
            status: 'success',
            path: finalPath,
            type,
            customArtworkLocked: true,
            artworkSource: 'creator',
            artworkUpdatedAt: game.artworkUpdatedAt,
        };
    }

    // ─── Mutations ────────────────────────────────────────────────────────────

    async renameGame(gameId, newName) {
        const index = this._dbCache.findIndex(g => String(g.id) === String(gameId));
        if (index === -1) return { status: 'error', message: 'Game not found' };

        const game = this._dbCache[index];
        const oldName = game.name || game.title || '';

        if (!game.originalName && oldName && oldName !== newName) {
            game.originalName = oldName;
        }

        game.name             = newName;
        game.title            = newName;
        game.customTitle      = newName;
        game.customTitleLocked = true;
        game.titleSource      = 'creator';
        game.titleUpdatedAt   = Date.now();

        this.saveDatabase();

        return {
            status:            'success',
            newName,
            customTitleLocked: true,
            titleSource:       'creator',
            titleUpdatedAt:    game.titleUpdatedAt,
        };
    }

    async removeGame(gameId) {
        const index = this._dbCache.findIndex(g => String(g.id) === String(gameId));
        if (index === -1) return { status: 'error', message: 'Game not found' };
        this._dbCache[index].isHidden = true;
        this.saveDatabase();
        return { status: 'success' };
    }

    async unhideAllGames() {
        let count = 0;
        this._dbCache.forEach(g => { if (g.isHidden) { g.isHidden = false; count++; } });
        if (count > 0) {
            this.saveDatabase();
            return { status: 'success', restoredCount: count };
        }
        return { status: 'no_hidden' };
    }

    async restoreSpecificGames(gameIds) {
        let count = 0;
        this._dbCache.forEach(g => {
            if (gameIds.includes(String(g.id))) { g.isHidden = false; count++; }
        });
        if (count > 0) {
            this.saveDatabase();
            return { status: 'success', count };
        }
        return { status: 'error', message: 'Nothing restored' };
    }

    async reorderLibrary(newOrderedIds) {
        try {
            const gameMap = new Map(this._dbCache.map(g => [g.id, g]));
            const ordered = newOrderedIds.filter(id => gameMap.has(id)).map(id => {
                const g = gameMap.get(id);
                gameMap.delete(id);
                return g;
            });
            this._dbCache = [...ordered, ...gameMap.values()];
            this.saveDatabase();
            return { status: 'success' };
        } catch (err) {
            this._log.error('[Reorder]', err);
            return { status: 'error' };
        }
    }

    // ─── Playtime / session mutations ─────────────────────────────────────────

    async updatePlaytime(gameId, playedMinutes) {
        const index = this._dbCache.findIndex(g => String(g.id) === String(gameId));
        if (index === -1) return { status: 'error', message: 'Game not found' };

        const game = this._dbCache[index];
        if (game.timeTrackingEnabled === false) return { status: 'tracking_disabled' };

        game.totalPlaytime = (game.totalPlaytime || 0) + playedMinutes;
        game.lastPlayed = Date.now();

        if (!game.playSessions) game.playSessions = [];
        const today = new Date().toISOString().split('T')[0];
        const legacySession = game.playSessions.find(s => s.date === today && !s.startedAt);
        if (legacySession) legacySession.minutes = (legacySession.minutes || 0) + playedMinutes;
        else game.playSessions.push({ date: today, minutes: playedMinutes });

        this.saveDatabase();
        return {
            status: 'success',
            totalPlaytime: game.totalPlaytime,
            lastPlayed: game.lastPlayed,
            lastQualifiedPlayed: game.lastQualifiedPlayed,
            playSessions: game.playSessions,
        };
    }

    async saveQualifiedSession(gameId, sessionData) {
        const index = this._dbCache.findIndex(g => String(g.id) === String(gameId));
        if (index === -1) return { status: 'error', message: 'Game not found' };

        const game = this._dbCache[index];
        if (game.timeTrackingEnabled === false) return { status: 'tracking_disabled' };

        const {
            countedMinutes      = 0,
            totalCountedMinutes = countedMinutes,
            rawRuntimeMinutes   = 0,
            idleMinutes         = 0,
            backgroundMinutes   = 0,
            foregroundSeen      = false,
            confidence          = 'medium',
            endReason           = '',
            startedAt           = Date.now(),
            endedAt             = Date.now(),
            isQualified         = false,
        } = sessionData;

        if (countedMinutes > 0) {
            game.totalPlaytime     = (game.totalPlaytime     || 0) + countedMinutes;
            game.rawRuntimeMinutes = (game.rawRuntimeMinutes || 0) + rawRuntimeMinutes;
            game.idleMinutes       = (game.idleMinutes       || 0) + idleMinutes;
            game.backgroundMinutes = (game.backgroundMinutes || 0) + backgroundMinutes;
        }

        game.lastDetectedPlayed = endedAt;

        if (countedMinutes > 0) {
            game.lastPlayed = endedAt;
        }
        if (isQualified) {
            game.lastQualifiedPlayed = endedAt;
        }

        if (!game.playSessions) game.playSessions = [];
        const today = new Date(endedAt).toISOString().split('T')[0];
        game.playSessions.push({
            date:             today,
            startedAt,
            endedAt,
            minutes:          totalCountedMinutes,
            countedMinutes:   totalCountedMinutes,
            rawRuntimeMinutes,
            idleMinutes,
            backgroundMinutes,
            foregroundSeen,
            confidence,
            endReason,
            qualified:        isQualified,
        });

        if (game.playSessions.length > 500) {
            game.playSessions = game.playSessions.slice(-500);
        }

        this.saveDatabase();
        return {
            status:              'success',
            totalPlaytime:       game.totalPlaytime,
            lastPlayed:          game.lastPlayed,
            lastQualifiedPlayed: game.lastQualifiedPlayed,
            playSessions:        game.playSessions,
            sessionQualified:    isQualified,
        };
    }

    async setTimeTrackingEnabled(gameId, enabled) {
        try {
            const game = this._dbCache.find(g => String(g.id) === String(gameId));
            if (!game) return { status: 'error', error: 'Game not found', gameId };
            game.timeTrackingEnabled = !!enabled;
            this.saveDatabase();
            return { status: 'success', gameId, timeTrackingEnabled: game.timeTrackingEnabled };
        } catch (err) {
            return { status: 'error', error: err.message, gameId };
        }
    }

    getTimeTrackingEnabled(gameId) {
        try {
            const game = this._dbCache.find(g => String(g.id) === String(gameId));
            if (!game) return { status: 'error', error: 'Game not found', gameId };
            return { status: 'success', gameId, timeTrackingEnabled: game.timeTrackingEnabled !== false };
        } catch (err) {
            return { status: 'error', error: err.message, gameId };
        }
    }
}

module.exports = { JsonGameRepository };
