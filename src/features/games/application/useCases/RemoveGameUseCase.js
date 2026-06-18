'use strict';

class RemoveGameUseCase {
    /** @param {import('../../domain/repositories/GamesRepository').GamesRepository} gamesRepository */
    constructor(gamesRepository) {
        this._repo = gamesRepository;
    }

    /**
     * @param   {string} gameId
     * @returns {Promise<object>}  legacy removeGame result
     */
    execute(gameId) {
        return this._repo.removeGame(gameId);
    }
}

module.exports = { RemoveGameUseCase };
