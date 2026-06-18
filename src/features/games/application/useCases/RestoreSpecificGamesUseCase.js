'use strict';

class RestoreSpecificGamesUseCase {
    /** @param {import('../../domain/repositories/GamesRepository').GamesRepository} gamesRepository */
    constructor(gamesRepository) {
        this._repo = gamesRepository;
    }

    /**
     * @param   {string[]} ids
     * @returns {Promise<object>}  { status: 'success', count } or { status: 'error', message }
     */
    execute(ids) {
        return this._repo.restoreSpecificGames(ids);
    }
}

module.exports = { RestoreSpecificGamesUseCase };
