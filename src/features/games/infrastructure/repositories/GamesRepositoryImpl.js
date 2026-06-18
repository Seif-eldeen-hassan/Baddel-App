'use strict';

const { GamesRepository } = require('../../domain/repositories/GamesRepository');

// ─── GamesRepositoryImpl — Legacy Bridge ─────────────────────────────────────
//
// Infrastructure implementation of GamesRepository that delegates to the
// legacy gameScanner functions during the Strangler Fig migration.
//
// Data flow:
//   Use case → GamesRepositoryImpl → getSavedGames() / getHiddenGames()
//                                      └─ engine.dbCache (in-memory, synchronous)
//
// Both wrapped functions are synchronous — no I/O occurs at call time.
//
// This class contains NO business logic. It exists only to satisfy the
// domain contract while the legacy system remains the source of truth.
// Once gameScanner is replaced by a proper persistence layer this class
// will be swapped out without touching any use case or IPC code.

class GamesRepositoryImpl extends GamesRepository {
    /**
     * @param {{
     *   getSavedGames:  () => object[],
     *   getHiddenGames: () => object[],
     * }} deps
     */
    constructor({ getSavedGames, getHiddenGames, reorderLibrary, unhideAllGames, renameGame, restoreSpecificGames, removeGame }) {
        super();
        this._getSavedGames        = getSavedGames;
        this._getHiddenGames       = getHiddenGames;
        this._reorderLibrary       = reorderLibrary;
        this._unhideAllGames       = unhideAllGames;
        this._renameGame           = renameGame;
        this._restoreSpecificGames = restoreSpecificGames;
        this._removeGame           = removeGame;
    }

    /**
     * Mirrors the logic in gameLibraryHandlers.js `get-game-by-id` exactly:
     *   const stored = getSavedGames();
     *   return stored.find(g => String(g.id) === String(gameId)) || null;
     *
     * String coercion on both sides is intentional — IDs are MD5 hex strings
     * but callers occasionally pass numbers from older serialised state.
     *
     * @param   {string} id
     * @returns {object|null}
     */
    getGameById(id) {
        try {
            const stored = this._getSavedGames();
            return stored.find(g => String(g.id) === String(id)) || null;
        } catch (err) {
            console.warn('[GamesRepositoryImpl] getGameById error:', err.message);
            return null;
        }
    }

    /**
     * Direct delegation — no transformation.
     * Mirrors: ipcMain.handle('get-hidden-games', () => getHiddenGames())
     *
     * @returns {object[]}
     */
    getHiddenGames() {
        return this._getHiddenGames();
    }

    /**
     * Direct delegation — no transformation.
     * Mirrors: ipcMain.handle('reorder-library', (_, ids) => reorderLibrary(ids))
     *
     * @param   {string[]} ids
     * @returns {object}
     */
    reorderLibrary(ids) {
        return this._reorderLibrary(ids);
    }

    /**
     * Direct delegation — no transformation.
     * Mirrors: ipcMain.handle('unhide-all-games', () => unhideAllGames())
     *
     * @returns {object}
     */
    unhideAllGames() {
        return this._unhideAllGames();
    }

    /**
     * Direct delegation — no transformation.
     * Mirrors: ipcMain.handle('rename-game', (_, id, name) => renameGame(id, name))
     *
     * @param   {string} gameId
     * @param   {string} newName
     * @returns {object}
     */
    renameGame(gameId, newName) {
        return this._renameGame(gameId, newName);
    }

    /**
     * Direct delegation — no transformation.
     * Mirrors: ipcMain.handle('restore-specific-games', (_, ids) => restoreSpecificGames(ids))
     *
     * @param   {string[]} ids
     * @returns {Promise<object>}
     */
    restoreSpecificGames(ids) {
        return this._restoreSpecificGames(ids);
    }

    /**
     * Direct delegation — no transformation.
     * Mirrors: ipcMain.handle('remove-game', (_, id) => removeGame(id))
     *
     * @param   {string} gameId
     * @returns {Promise<object>}
     */
    removeGame(gameId) {
        return this._removeGame(gameId);
    }
}

module.exports = { GamesRepositoryImpl };
