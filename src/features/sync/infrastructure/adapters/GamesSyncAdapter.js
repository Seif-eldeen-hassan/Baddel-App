'use strict';

class GamesSyncAdapter {
    constructor({ getGamesFeature } = {}) {
        this.getGamesFeature = getGamesFeature;
    }

    getGamesApi() {
        const feature = this.getGamesFeature ? this.getGamesFeature() : null;
        if (feature && typeof feature.getGamesApi === 'function') {
            return feature.getGamesApi();
        }
        return feature;
    }

    async getSavedGames() {
        const api = this.getGamesApi();
        if (!api || typeof api.getSavedGames !== 'function') return [];
        return api.getSavedGames();
    }

    async getLocalSteamGames() {
        const api = this.getGamesApi();
        if (!api || typeof api.getLocalSteamGames !== 'function') return [];
        return api.getLocalSteamGames();
    }

    async removeEpicNonGameEntries(...args) {
        const api = this.getGamesApi();
        if (!api || typeof api.removeEpicNonGameEntries !== 'function') return undefined;
        return api.removeEpicNonGameEntries(...args);
    }
}

module.exports = {
    GamesSyncAdapter,
};
