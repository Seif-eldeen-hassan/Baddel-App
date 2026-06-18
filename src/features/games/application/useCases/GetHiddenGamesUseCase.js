'use strict';

class GetHiddenGamesUseCase {
    /** @param {{ getHiddenGames: () => object[] }} gamesRepository */
    constructor(gamesRepository) {
        this._repo = gamesRepository;
    }

    /**
     * @returns {object[]}
     */
    execute() {
        return this._repo.getHiddenGames();
    }
}

module.exports = { GetHiddenGamesUseCase };
