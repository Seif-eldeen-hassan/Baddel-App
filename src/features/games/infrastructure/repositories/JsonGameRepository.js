'use strict';

const { resolveCanonicalGameIdentity } = require('../../application/services/CanonicalGameIdentityResolver');
const { pathToFileURL } = require('url');
const {
    ARTWORK_TYPES,
    migrateLegacyArtworkState,
    applyExplicitOverride,
    applyFallback,
    clearExplicitOverride,
    projectArtworkStateToLegacyAliases,
    normalizeArtworkWriteSource,
} = require('../../domain/services/GameArtworkState');

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
//                reorderLibrary, deleteGameById, deleteGamesByIds
//
// What this class does NOT do:
//   • deleteGamePermanently orchestration (cross-cutting: images, mrm, metadata cache)
//   • Path resolution via ImageCacheService — that stays in BaddelEngine
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
    constructor({ fs, path, crypto, databasePath, logger = console, keyResolver = null, artworkAssetStore = null }) {
        this._fs          = fs;
        this._path        = path;
        this._crypto      = crypto;
        this._dbPath      = databasePath;
        this._dbFolder    = path.dirname(databasePath);
        this._log         = logger;
        this._keyResolver = keyResolver; // makeInstalledGameKey injected by BaddelEngine
        this._artworkAssetStore = artworkAssetStore;
        this._dbCache     = [];
        this._saveTimer   = null;

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
        this._migrateArtworkStateRecords();
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

    _migrateArtworkStateRecords() {
        let changed = false;
        for (let i = 0; i < this._dbCache.length; i++) {
            const game = this._dbCache[i];
            if (!game || typeof game !== 'object') continue;
            const wasV2 = game.artworkState?.version === 2;
            const materialized = this._materializeStoredExplicitArtworkSync(game);
            this._dbCache[i] = projectArtworkStateToLegacyAliases(game);
            if (!wasV2 || materialized) changed = true;
        }
        if (changed) {
            this._log.log('[DB] Migrated artwork records to Artwork State V2.');
            try {
                this._fs.writeFileSync(this._dbPath, JSON.stringify(this._dbCache, null, 2), 'utf8');
            } catch (err) {
                this._log.error('[DB] Artwork State V2 migration save failed:', err);
                this.saveDatabase();
            }
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

    /** All games including hidden and isInstalled === false records. */
    getAllGames() {
        return this._dbCache;
    }

    getHiddenGames() {
        return this._dbCache.filter(g => g.isHidden);
    }

    getMissingInstalledGames() {
        return this._dbCache.filter(g => g.installSource === 'scanner' && g.isInstalled === false);
    }

    getGameById(gameId) {
        return this._dbCache.find(g => String(g.id) === String(gameId)) || null;
    }

    _normalizeArtworkPath(value) {
        if (!value || typeof value !== 'string') return value || null;
        const trimmed = value.trim();
        if (!trimmed) return null;
        if (trimmed.startsWith('file://data:image/')) return trimmed.slice('file://'.length);
        if (/^(?:https?|file):\/\//i.test(trimmed) || /^data:image\//i.test(trimmed)) return trimmed;
        if (/^blob:/i.test(trimmed)) throw new Error('Blob artwork URLs are transient and cannot be persisted.');
        if (this._path.isAbsolute(trimmed)) {
            if (this._fs.existsSync(trimmed)) return pathToFileURL(trimmed).href;
            return `file://${trimmed}`;
        }
        if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) throw new Error('Unsupported artwork URL scheme.');
        return trimmed;
    }

    _materializeStoredExplicitArtworkSync(game) {
        if (!this._artworkAssetStore || !game) return false;
        const state = migrateLegacyArtworkState(game);
        let changed = false;
        for (const type of ARTWORK_TYPES) {
            const node = state[type];
            if (!node?.locked || !node.overrideValue) continue;
            const before = node.overrideValue;
            if (this._artworkAssetStore.ownsUrl(before)) continue;
            try {
                const after = this._artworkAssetStore.materializeSync({
                    canonicalGameId: game.id,
                    type,
                    value: before,
                });
                if (after && after !== before) {
                    node.overrideValue = after;
                    changed = true;
                    this._log.log?.('[ArtworkAssetMigration] materialized explicit artwork', {
                        canonicalGameId: String(game.id || ''),
                        type,
                    });
                }
            } catch (err) {
                this._log.warn?.('[ArtworkAssetMigration] skipped explicit artwork', {
                    canonicalGameId: String(game.id || ''),
                    type,
                    reason: err && err.message,
                });
            }
        }
        if (changed) game.artworkState = state;
        return changed;
    }

    async _materializeExplicitArtworkUpdates(game, updates, { source, mode }) {
        const normalized = normalizeArtworkWriteSource(source);
        const writeMode = mode || normalized.mode;
        if (writeMode !== 'explicit' || !this._artworkAssetStore) return updates;
        const materialized = { ...updates };
        for (const type of ARTWORK_TYPES) {
            if (!(type in materialized) || materialized[type] == null) continue;
            materialized[type] = await this._artworkAssetStore.materialize({
                canonicalGameId: game.id,
                type,
                value: this._normalizeArtworkPath(materialized[type]),
            });
        }
        return materialized;
    }

    _applyArtworkUpdatesToGame(game, updates = {}, {
        source = 'server',
        mode = null,
        updatedAt = Date.now(),
        expectedRevision = null,
        expectedRevisions = null,
    } = {}) {
        const normalized = normalizeArtworkWriteSource(source);
        const writeMode = mode || normalized.mode;
        let state = migrateLegacyArtworkState(game);
        const perType = {};

        for (const type of ARTWORK_TYPES) {
            if (!(type in updates)) continue;
            const value = this._normalizeArtworkPath(updates[type]);
            let result;
            if (writeMode === 'clear-explicit' || (writeMode === 'explicit' && value == null)) {
                result = clearExplicitOverride(state, type, { updatedAt });
            } else if (writeMode === 'explicit') {
                const perTypeExpectedRevision =
                    expectedRevisions && Object.prototype.hasOwnProperty.call(expectedRevisions, type)
                        ? expectedRevisions[type]
                        : expectedRevision;
                result = applyExplicitOverride(state, type, value, {
                    source: normalized.source,
                    updatedAt,
                    expectedRevision: perTypeExpectedRevision,
                });
            } else {
                result = applyFallback(state, type, value, { source: normalized.source, updatedAt });
            }
            state = result.state;
            const previous = result.previous || {};
            perType[type] = {
                applied: result.applied === true,
                status: result.applied ? 'applied' : 'skipped',
                reason: result.reason,
                value,
                previousSource: previous.overrideSource || previous.fallbackSource || null,
                source: normalized.source,
                mode: writeMode,
                previousRevision: previous.revision || 0,
                revision: state[type]?.revision || 0,
                effectiveValue: state[type]?.locked ? state[type]?.overrideValue : (state[type]?.fallbackValue || null),
            };
        }

        game.artworkState = state;
        Object.assign(game, projectArtworkStateToLegacyAliases(game));
        return perType;
    }

    async setGameArtwork(identity, updates = {}, {
        source = 'settings',
        updatedAt = Date.now(),
        mode = null,
        operationId = null,
        expectedRevision = null,
        expectedRevisions = null,
    } = {}) {
        const requestedGameId = identity && typeof identity === 'object'
            ? (identity.gameId || identity.id || identity.localGameId || identity.installedId || null)
            : identity;
        const resolved = resolveCanonicalGameIdentity(identity, this._dbCache);
        if (resolved.status !== 'success') {
            return {
                status: 'error',
                message: 'Game not found',
                requestedGameId,
                canonicalGameId: null,
                persisted: false,
                operationId,
            };
        }

        const game = resolved.game;
        let perType;
        try {
            const preparedUpdates = await this._materializeExplicitArtworkUpdates(game, updates, { source, mode });
            perType = this._applyArtworkUpdatesToGame(game, preparedUpdates, {
                source,
                updatedAt,
                mode,
                expectedRevision,
                expectedRevisions,
            });
        } catch (err) {
            return {
                status: 'error',
                message: err && err.message ? err.message : 'Failed to materialize artwork',
                requestedGameId,
                canonicalGameId: game.id,
                operationId,
                persisted: false,
            };
        }

        try {
            await this.flushDatabase();
            return {
                status: Object.values(perType).some(r => r.applied === false) ? 'partial' : 'success',
                requestedGameId,
                canonicalGameId: game.id,
                matchReason: resolved.reason,
                operationId,
                perType,
                updatedGame: JSON.parse(JSON.stringify(game)),
                persisted: true,
            };
        } catch (err) {
            this._log.error('[DB] setGameArtwork flush failed:', err);
            return {
                status: 'error',
                message: 'Failed to persist game artwork',
                requestedGameId,
                canonicalGameId: game.id,
                operationId,
                persisted: false,
            };
        }
    }

    async resetGameArtwork(identity, {
        types = ['cover'],
        operationId = null,
        expectedRevisions = null,
        updatedAt = Date.now(),
    } = {}) {
        const requestedGameId = identity && typeof identity === 'object'
            ? (identity.gameId || identity.id || identity.localGameId || identity.installedId || null)
            : identity;
        const resolved = resolveCanonicalGameIdentity(identity, this._dbCache);
        if (resolved.status !== 'success') {
            return {
                status: 'error',
                message: 'Game not found',
                requestedGameId,
                canonicalGameId: null,
                persisted: false,
                operationId,
                results: {},
            };
        }

        const requestedTypes = (Array.isArray(types) ? types : [types])
            .filter(type => ARTWORK_TYPES.includes(type));
        if (!requestedTypes.length) {
            return {
                status: 'error',
                message: 'No valid artwork types requested',
                requestedGameId,
                canonicalGameId: resolved.game.id,
                persisted: false,
                operationId,
                results: {},
            };
        }

        const game = resolved.game;
        let state = migrateLegacyArtworkState(game);
        const results = {};

        for (const type of requestedTypes) {
            const previous = { ...(state[type] || {}) };
            const expectedRevision = expectedRevisions &&
                Object.prototype.hasOwnProperty.call(expectedRevisions, type)
                ? expectedRevisions[type]
                : null;
            if (expectedRevision != null && Number(expectedRevision) < Number(previous.revision || 0)) {
                results[type] = {
                    applied: false,
                    reason: 'stale-revision',
                    previousSource: previous.overrideSource || null,
                    revision: previous.revision || 0,
                    effectiveValue: previous.locked ? previous.overrideValue : (previous.fallbackValue || null),
                    fallbackSource: previous.fallbackSource || null,
                };
                continue;
            }

            const result = clearExplicitOverride(state, type, { updatedAt });
            state = result.state;
            const item = state[type] || {};
            results[type] = {
                applied: result.applied === true,
                reason: previous.locked && previous.overrideValue ? 'override-cleared' : 'no-explicit-override',
                previousSource: previous.overrideSource || null,
                revision: item.revision || 0,
                effectiveValue: item.locked ? item.overrideValue : (item.fallbackValue || null),
                fallbackSource: item.fallbackSource || null,
            };
        }

        game.artworkState = state;
        Object.assign(game, projectArtworkStateToLegacyAliases(game));
        game.artworkUpdatedAt = updatedAt;

        try {
            await this.flushDatabase();
            return {
                status: Object.values(results).some(r => r.applied === false) ? 'partial' : 'success',
                persisted: true,
                requestedGameId,
                canonicalGameId: game.id,
                matchReason: resolved.reason,
                operationId,
                results,
                updatedGame: JSON.parse(JSON.stringify(game)),
            };
        } catch (err) {
            this._log.error('[DB] resetGameArtwork flush failed:', err);
            return {
                status: 'error',
                message: 'Failed to persist game artwork reset',
                requestedGameId,
                canonicalGameId: game.id,
                operationId,
                persisted: false,
                results,
            };
        }
    }

    /**
     * Finds an existing game whose stored command or executablePath matches the
     * supplied paths after normalisation.
     * Incoming paths: path.normalize + lowercase + trim (no quote-strip).
     * Stored fields:  path.normalize + quote-strip + trim + lowercase.
     * Searches the full cache — includes hidden and isInstalled === false records.
     * Returns the live object reference, or null when no match exists.
     * Does not mutate. Does not call saveDatabase.
     */
    findManualGameByPaths(launchPath, effectivePath) {
        const normalizeIncoming = v => this._path.normalize(v || '').toLowerCase().trim();
        const normalizeStored   = v => this._path.normalize((v || '').replace(/"/g, '').trim()).toLowerCase();
        const wantCmd = normalizeIncoming(launchPath);
        const wantExe = normalizeIncoming(effectivePath);
        return this._dbCache.find(g =>
            normalizeStored(g.command) === wantCmd || normalizeStored(g.executablePath) === wantExe
        ) || null;
    }

    // ─── Image mutations ──────────────────────────────────────────────────────

    async updateGameMetadata(gameId, metadata, {
        source = 'server',
        force = false,
        expectedRevision = null,
        expectedRevisions = null,
        operationId = null,
    } = {}) {
        const requestedGameId = gameId && typeof gameId === 'object'
            ? (gameId.gameId || gameId.id || gameId.localGameId || gameId.installedId || null)
            : gameId;
        const resolved = resolveCanonicalGameIdentity(gameId, this._dbCache);
        if (resolved.status !== 'success') {
            return {
                status: 'error',
                message: 'Game not found',
                requestedGameId,
                canonicalGameId: null,
                persisted: false,
            };
        }
        const game = resolved.game;

        const stateForGuard = migrateLegacyArtworkState(game);
        const isCreator = source === 'creator';
        void (isCreator || force);
        const artLocked      = game.customArtworkLocked === true;
        const serverVerified = (game.artworkSource === 'server-details' && !!game.artworkUpdatedAt) ||
            ARTWORK_TYPES.some(type => stateForGuard[type]?.fallbackSource === 'server-details');
        const skipArt =
            (artLocked && source !== 'creator' && source !== 'settings') ||
            (!force && serverVerified && !artLocked && (source === 'pipeline' || source === 'addManual'));
        const artUpdates = {};
        let perType = {};
        if (!skipArt) {
            if ('cover' in metadata && metadata.cover) artUpdates.cover = metadata.cover;
            if (('hero' in metadata || 'heroImage' in metadata) && (metadata.hero || metadata.heroImage)) {
                artUpdates.hero = metadata.hero || metadata.heroImage;
            }
            if ('logo' in metadata && metadata.logo) artUpdates.logo = metadata.logo;
        }

        if (Object.keys(artUpdates).length > 0) {
            if (source === 'creator') {
                if ('cover' in artUpdates && !game.creatorOriginalCover) game.creatorOriginalCover = game.defaultImage || game.image || null;
                if ('hero' in artUpdates && !game.creatorOriginalHero) game.creatorOriginalHero = game.defaultHero || game.heroImage || null;
                if ('logo' in artUpdates && !game.creatorOriginalLogo) game.creatorOriginalLogo = game.defaultLogo || game.logo || null;
            }
            const mode = source === 'creator' || source === 'settings' ? 'explicit' : 'fallback';
            try {
                const preparedUpdates = await this._materializeExplicitArtworkUpdates(game, artUpdates, { source, mode });
                perType = this._applyArtworkUpdatesToGame(game, preparedUpdates, {
                    source,
                    mode,
                    updatedAt: metadata.artworkUpdatedAt || Date.now(),
                    expectedRevision,
                    expectedRevisions,
                });
            } catch (err) {
                return {
                    status: 'error',
                    message: err && err.message ? err.message : 'Failed to materialize artwork',
                    requestedGameId,
                    canonicalGameId: game.id,
                    persisted: false,
                };
            }
        }
        if (!skipArt && source === 'creator' && Object.prototype.hasOwnProperty.call(metadata, 'logo') && metadata.logo === null) {
            perType = {
                ...perType,
                ...this._applyArtworkUpdatesToGame(game, { logo: null }, { source: 'creator', mode: 'clear-explicit', updatedAt: metadata.artworkUpdatedAt || Date.now() }),
            };
            this._applyArtworkUpdatesToGame(game, { logo: null }, { source: 'creator', mode: 'fallback', updatedAt: metadata.artworkUpdatedAt || Date.now() });
        }

        if ('name' in metadata) {
            const nextName = String(metadata.name || '').trim();
            if (nextName) {
                game.name = nextName;
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
        Object.assign(game, projectArtworkStateToLegacyAliases(game));
        if (metadata.customArtworkLocked !== undefined) {
            game.customArtworkLocked = !!metadata.customArtworkLocked;
        }
        if (metadata.artworkSource !== undefined) {
            game.artworkSource = metadata.artworkSource;
        }
        if (metadata.artworkUpdatedAt !== undefined) {
            game.artworkUpdatedAt = metadata.artworkUpdatedAt;
        }

        try {
            await this.flushDatabase();
            return {
                status: Object.values(perType).some(r => r.applied === false) ? 'partial' : 'success',
                requestedGameId,
                canonicalGameId: game.id,
                matchReason: resolved.reason,
                operationId,
                perType,
                updatedGame: JSON.parse(JSON.stringify(game)),
                persisted: true,
            };
        } catch (err) {
            this._log.error('[DB] updateGameMetadata flush failed:', err);
            return {
                status: 'error',
                message: 'Failed to persist game metadata',
                requestedGameId,
                canonicalGameId: game.id,
                persisted: false,
            };
        }
    }

    async updateGameImage(gameId, newImagePath, type = 'cover', {
        source = 'settings',
        locked = true,
        updatedAt = Date.now(),
    } = {}) {
        const requestedGameId = gameId && typeof gameId === 'object'
            ? (gameId.gameId || gameId.id || gameId.localGameId || gameId.installedId || null)
            : gameId;
        const resolved = resolveCanonicalGameIdentity(gameId, this._dbCache);
        if (resolved.status !== 'success') {
            return {
                status: 'error',
                message: 'Game not found',
                requestedGameId,
                canonicalGameId: null,
                persisted: false,
            };
        }

        const game = resolved.game;
        let finalPath;
        try {
            const normalizedPath = this._normalizeArtworkPath(newImagePath);
            const updates = await this._materializeExplicitArtworkUpdates(game, { [type]: normalizedPath }, {
                source,
                mode: locked ? 'explicit' : 'fallback',
            });
            finalPath = updates[type];
        } catch (err) {
            return {
                status: 'error',
                message: err && err.message ? err.message : 'Failed to materialize game image',
                requestedGameId,
                canonicalGameId: game.id,
                persisted: false,
            };
        }
        const mode = locked ? 'explicit' : 'fallback';
        this._applyArtworkUpdatesToGame(game, { [type]: finalPath }, { source, mode, updatedAt });

        try {
            await this.flushDatabase();
            return {
                status: 'success',
                requestedGameId,
                canonicalGameId: game.id,
                matchReason: resolved.reason,
                path: finalPath,
                type,
                customArtworkLocked: !!locked,
                artworkSource: source,
                artworkUpdatedAt: game.artworkUpdatedAt,
                updatedGame: JSON.parse(JSON.stringify(game)),
                persisted: true,
            };
        } catch (err) {
            this._log.error('[DB] updateGameImage flush failed:', err);
            return {
                status: 'error',
                message: 'Failed to persist game image',
                requestedGameId,
                canonicalGameId: game.id,
                persisted: false,
            };
        }
    }

    applyImageReset(gameId, resolvedPaths, { type = 'cover', resetAll = false } = {}) {
        const index = this._dbCache.findIndex(g => String(g.id) === String(gameId));
        if (index === -1) return { status: 'error', message: 'Game not found' };

        const game  = this._dbCache[index];
        const paths = resolvedPaths || {};
        const now   = Date.now();

        if (resetAll) {
            const cover = paths.cover ?? null;
            const hero  = paths.hero  ?? null;
            const logo  = paths.logo  ?? null;

            for (const t of ARTWORK_TYPES) {
                this._applyArtworkUpdatesToGame(game, { [t]: null }, { source: 'reset', mode: 'clear-explicit', updatedAt: now });
            }
            this._applyArtworkUpdatesToGame(game, { cover, hero, logo }, { source: 'reset', mode: 'fallback', updatedAt: now });
            game.artworkSource = 'reset';
            game.artworkUpdatedAt = now;

            delete game.creatorOriginalCover;
            delete game.creatorOriginalHero;
            delete game.creatorOriginalLogo;

            this.saveDatabase();
            return { status: 'success', type, cover, hero, logo };
        }

        const restoredPath =
            type === 'hero' ? (paths.hero  ?? null) :
            type === 'logo' ? (paths.logo  ?? null) :
                              (paths.cover ?? null);

        this._applyArtworkUpdatesToGame(game, { [type]: null }, { source: 'reset', mode: 'clear-explicit', updatedAt: now });
        this._applyArtworkUpdatesToGame(game, { [type]: restoredPath }, { source: 'reset', mode: 'fallback', updatedAt: now });
        game.artworkSource = game.customArtworkLocked ? game.artworkSource : 'reset';
        game.artworkUpdatedAt = now;

        this.saveDatabase();
        return { status: 'success', type, cover: null, hero: null, logo: null, path: restoredPath };
    }

    // ─── Upsert ───────────────────────────────────────────────────────────────

    /**
     * Find-or-create a game record in the DB cache using a three-way match.
     * Callers are responsible for calling saveDatabase() after all upserts are done.
     *
     * Pre-conditions (enforced by BaddelEngine.upsertGame before calling this):
     *   • game.id is set (generated or caller-supplied)
     *   • game.installedGameKey is stamped
     *   • cachedCover/Hero/Logo are pre-resolved via ImageCacheService
     *
     * Match priority: id (strict ===) → installedGameKey → normalised command.
     *
     * @param {object} game                - prepared game object (may be mutated by caller)
     * @param {object} [opts]
     * @param {string|null} [opts.cachedCover] - file:// URL or null (image cache recovery)
     * @param {string|null} [opts.cachedHero]
     * @param {string|null} [opts.cachedLogo]
     */
    _findUpsertGameIndex(game) {
        const incomingCommand = (game.command || '').replace(/"/g, '').toLowerCase().trim();
        return this._dbCache.findIndex(g => {
            const existingKey = g.installedGameKey ||
                (this._keyResolver ? this._keyResolver(g) : null);
            const existingCommand = (g.command || '').replace(/"/g, '').toLowerCase().trim();
            return g.id === game.id ||
                (game.installedGameKey && existingKey === game.installedGameKey) ||
                (incomingCommand && existingCommand && incomingCommand === existingCommand);
        });
    }

    hasUpsertMatch(game) {
        return this._findUpsertGameIndex(game) > -1;
    }

    upsertGameRecord(game, { cachedCover = null, cachedHero = null, cachedLogo = null } = {}) {
        const index = this._findUpsertGameIndex(game);

        if (index > -1) {
            const existing = this._dbCache[index];
            const merged = {
                ...existing,
                command:          game.command          || existing.command,
                path:             game.path             || existing.path,
                platform:         game.platform         || existing.platform,
                launchCommand:    game.launchCommand    || game.command || existing.launchCommand,
                installSource:    game.installSource    || existing.installSource,
                scannerPlatform:  game.scannerPlatform  || existing.scannerPlatform,
                launcherGameId:   game.launcherGameId   || existing.launcherGameId,
                installedGameKey: game.installedGameKey || existing.installedGameKey,
                executablePath:   game.executablePath   || existing.executablePath,
                exeCandidates:    Array.isArray(game.exeCandidates) ? game.exeCandidates : existing.exeCandidates,
                allIds:           { ...(existing.allIds || {}), ...(game.allIds || {}) },
                namespace:        game.namespace        || existing.namespace,
                appName:          game.appName          || existing.appName,
                catalogNamespace: game.catalogNamespace || existing.catalogNamespace,
                catalogItemId:    game.catalogItemId    || existing.catalogItemId,
                packageFamilyName: game.packageFamilyName || existing.packageFamilyName,
                riotProduct:      game.riotProduct      || existing.riotProduct,
                scanSourceDetail: game.scanSourceDetail || existing.scanSourceDetail,
                validationWarnings: Array.isArray(game.validationWarnings) ? game.validationWarnings : (existing.validationWarnings || []),
                installVerified:  game.installVerified  ?? existing.installVerified,
                isInstalled:      game.isInstalled      ?? existing.isInstalled ?? true,
                firstSeenAt:      existing.firstSeenAt  || game.firstSeenAt || existing.addedAt,
                lastSeenAt:       game.lastSeenAt       || existing.lastSeenAt,
                removedFromDiskAt: game.isInstalled === false ? (game.removedFromDiskAt || existing.removedFromDiskAt) : null,
                missingReason:    game.isInstalled === false ? (game.missingReason    || existing.missingReason)    : null,
                // ── Image field contract ─────────────────────────────────────────
                // Always prefer the richer / more recently loaded value.
                // A fresh scan may return null for image fields if the scanner did
                // not find art on this pass (e.g. Steam cover not yet cached).
                // Clobbering a good existing value with null is what causes the
                // Installed Games card to flip to hero+logo after a rescan.
                id:           existing.id,
            };
            const fallbackUpdates = {};
            const nextCover = cachedCover || game.image || game.cover || game.coverUrl || game.defaultImage || null;
            const nextHero  = cachedHero  || game.heroImage || game.hero || game.heroUrl || game.defaultHero || null;
            const nextLogo  = cachedLogo  || game.logo || game.logoUrl || game.defaultLogo || null;
            if (nextCover) fallbackUpdates.cover = nextCover;
            if (nextHero)  fallbackUpdates.hero = nextHero;
            if (nextLogo)  fallbackUpdates.logo = nextLogo;
            this._applyArtworkUpdatesToGame(merged, fallbackUpdates, { source: 'scanner', mode: 'fallback', updatedAt: Date.now() });
            this._dbCache[index] = merged;
        } else {
            // ── Recover cached images from disk if the DB was wiped (e.g. after reinstall) ──
            const inserted = {
                addedAt:  new Date().toISOString(),
                score:    100,
                isHidden: false,
                ...game,
            };
            this._applyArtworkUpdatesToGame(inserted, {
                cover: cachedCover || game.image || game.cover || game.coverUrl || game.defaultImage || null,
                hero:  cachedHero  || game.heroImage || game.hero || game.heroUrl || game.defaultHero || null,
                logo:  cachedLogo  || game.logo || game.logoUrl || game.defaultLogo || null,
            }, { source: 'scanner', mode: 'fallback', updatedAt: Date.now() });
            this._dbCache.push(inserted);
        }
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

    deleteGameById(gameId) {
        const before = this._dbCache.length;
        this._dbCache = this._dbCache.filter(g => String(g.id) !== String(gameId));
        return before - this._dbCache.length;
    }

    deleteGamesByIds(gameIds) {
        const ids = new Set((Array.isArray(gameIds) ? gameIds : []).map(id => String(id)));
        if (ids.size === 0) return 0;
        const before = this._dbCache.length;
        this._dbCache = this._dbCache.filter(g => !ids.has(String(g.id)));
        return before - this._dbCache.length;
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
