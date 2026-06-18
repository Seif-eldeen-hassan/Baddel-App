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
}

module.exports = { GamesRepository };
