'use strict';

class UnhideAllGamesUseCase {
    /** @param {{ unhideAllGames: () => object }} gamesRepository */
    constructor(gamesRepository) {
        this._repo = gamesRepository;
    }

    /**
     * @returns {object}  { status: 'success', restoredCount } or { status: 'no_hidden' }
     */
    execute() {
        return this._repo.unhideAllGames();
    }
}

module.exports = { UnhideAllGamesUseCase };
