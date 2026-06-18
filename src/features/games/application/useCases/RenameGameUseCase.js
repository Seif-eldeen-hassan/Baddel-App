'use strict';

class RenameGameUseCase {
    /** @param {{ renameGame: (gameId: string, newName: string) => object }} gamesRepository */
    constructor(gamesRepository) {
        this._repo = gamesRepository;
    }

    /**
     * @param   {string} gameId
     * @param   {string} newName
     * @returns {object}  { status, newName, customTitleLocked, titleSource, titleUpdatedAt }
     *                    or { status: 'error', message }
     */
    execute(gameId, newName) {
        return this._repo.renameGame(gameId, newName);
    }
}

module.exports = { RenameGameUseCase };
