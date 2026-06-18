'use strict';

class GetGameByIdUseCase {
    /** @param {{ getGameById: (id: string) => object|null }} gamesRepository */
    constructor(gamesRepository) {
        this._repo = gamesRepository;
    }

    /**
     * @param   {string} gameId
     * @returns {object|null}
     */
    execute(gameId) {
        return this._repo.getGameById(gameId);
    }
}

module.exports = { GetGameByIdUseCase };
