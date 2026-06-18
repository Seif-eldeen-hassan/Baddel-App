'use strict';

class ReorderLibraryUseCase {
    /** @param {{ reorderLibrary: (ids: string[]) => object }} gamesRepository */
    constructor(gamesRepository) {
        this._repo = gamesRepository;
    }

    /**
     * @param   {string[]} ids  Desired display order
     * @returns {object}        { status: 'success' } or { status: 'error' }
     */
    execute(ids) {
        return this._repo.reorderLibrary(ids);
    }
}

module.exports = { ReorderLibraryUseCase };
