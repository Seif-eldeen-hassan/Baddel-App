'use strict';

const { GamesRepository } = require('../../domain/repositories/GamesRepository');

// ─── GamesRepositoryImpl — Legacy Bridge ─────────────────────────────────────
//
// Infrastructure implementation of GamesRepository.
//
// Supports two injection paths (in order of preference):
//
//   1. jsonGameRepository (Step 13.4+):
//      A JsonGameRepository instance injected from BaddelEngine via main.js.
//      Methods delegate directly — no intermediate gameScanner wrapper hop.
//
//   2. Legacy function delegates (pre-13.4 / rollback):
//      Individual functions destructured from gameScanner module.exports.
//      Retained as fallback so tests and a rollback can still pass individual
//      functions without a JsonGameRepository instance.
//
// Only one path should be active in production at any time.
// When jsonGameRepository is provided it takes precedence for every method.
//
// This class contains NO business logic. It exists only to satisfy the
// domain contract while the legacy system remains the source of truth.

class GamesRepositoryImpl extends GamesRepository {
    /**
     * @param {{
     *   jsonGameRepository?:   import('./JsonGameRepository').JsonGameRepository,
     *   getSavedGames?:        () => object[],
     *   getHiddenGames?:       () => object[],
     *   reorderLibrary?:       (ids: string[]) => object,
     *   unhideAllGames?:       () => object,
     *   renameGame?:           (id: string, name: string) => object,
     *   restoreSpecificGames?: (ids: string[]) => Promise<object>,
     *   removeGame?:           (id: string) => Promise<object>,
     * }} deps
     */
    constructor({
        jsonGameRepository,
        getSavedGames,
        getHiddenGames,
        reorderLibrary,
        unhideAllGames,
        renameGame,
        restoreSpecificGames,
        removeGame,
    } = {}) {
        super();
        // Production path (Step 13.4+): jsonGameRepository is injected from BaddelEngine via main.js.
        // TODO: remove legacy delegate fallback once all call-sites pass jsonGameRepository.
        this._jsonGameRepository   = jsonGameRepository   || null;
        // Legacy function delegates — kept as fallback for tests / rollback only.
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
            const stored = this._jsonGameRepository
                ? this._jsonGameRepository.getSavedGames()
                : this._getSavedGames();
            return stored.find(g => String(g.id) === String(id)) || null;
        } catch (err) {
            console.warn('[GamesRepositoryImpl] getGameById error:', err.message);
            return null;
        }
    }

    getHiddenGames() {
        if (this._jsonGameRepository) return this._jsonGameRepository.getHiddenGames();
        return this._getHiddenGames();
    }

    reorderLibrary(ids) {
        if (this._jsonGameRepository) return this._jsonGameRepository.reorderLibrary(ids);
        return this._reorderLibrary(ids);
    }

    unhideAllGames() {
        if (this._jsonGameRepository) return this._jsonGameRepository.unhideAllGames();
        return this._unhideAllGames();
    }

    renameGame(gameId, newName) {
        if (this._jsonGameRepository) return this._jsonGameRepository.renameGame(gameId, newName);
        return this._renameGame(gameId, newName);
    }

    restoreSpecificGames(ids) {
        if (this._jsonGameRepository) return this._jsonGameRepository.restoreSpecificGames(ids);
        return this._restoreSpecificGames(ids);
    }

    removeGame(gameId) {
        if (this._jsonGameRepository) return this._jsonGameRepository.removeGame(gameId);
        return this._removeGame(gameId);
    }
}

module.exports = { GamesRepositoryImpl };
