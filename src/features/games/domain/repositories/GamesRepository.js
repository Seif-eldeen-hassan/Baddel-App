'use strict';

// ─── GamesRepository — Domain Contract ───────────────────────────────────────
//
// Pure interface for games data access. Implementations live in:
//   src/features/games/infrastructure/repositories/
//
// No IPC, no Electron, no filesystem. Only a data contract.
//
// Current implementors:
//   GamesRepositoryImpl — wraps gameScanner legacy functions (bridge phase)

class GamesRepository {
    /**
     * Retrieve a single game by its stable ID.
     *
     * @param   {string} id  MD5-hash game ID (stable across renames)
     * @returns {object|null} Game record, or null if not found
     */
    getGameById(id) {
        throw new Error(`${this.constructor.name} must implement getGameById(id)`);
    }

    /**
     * Retrieve all games that the user has hidden from the main library view.
     *
     * @returns {object[]} Array of hidden game records (may be empty)
     */
    getHiddenGames() {
        throw new Error(`${this.constructor.name} must implement getHiddenGames()`);
    }

    /**
     * Persist a new display order for the game library.
     *
     * @param   {string[]} ids  Ordered array of game IDs
     * @returns {object}        { status: 'success' } or { status: 'error' }
     */
    reorderLibrary(ids) {
        throw new Error(`${this.constructor.name} must implement reorderLibrary(ids)`);
    }

    /**
     * Clear the hidden flag on every game in the library.
     *
     * @returns {object}  { status: 'success', restoredCount } or { status: 'no_hidden' }
     */
    unhideAllGames() {
        throw new Error(`${this.constructor.name} must implement unhideAllGames()`);
    }

    /**
     * Rename a game and lock the title as creator-sourced.
     *
     * @param   {string} gameId
     * @param   {string} newName
     * @returns {object}  { status, newName, customTitleLocked, titleSource, titleUpdatedAt }
     *                    or { status: 'error', message }
     */
    renameGame(gameId, newName) {
        throw new Error(`${this.constructor.name} must implement renameGame(gameId, newName)`);
    }
}

module.exports = { GamesRepository };
