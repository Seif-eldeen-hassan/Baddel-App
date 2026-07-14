'use strict';

const LIBRARY_UPDATED_CHANNEL = 'library-updated';

class LibraryUpdateEmitter {
    constructor({
        getSavedGames,
        debounceMs = 1500,
        setTimeoutFn = setTimeout,
        clearTimeoutFn = clearTimeout,
    } = {}) {
        this.getSavedGames = getSavedGames;
        this.debounceMs = debounceMs;
        this.setTimeoutFn = setTimeoutFn;
        this.clearTimeoutFn = clearTimeoutFn;
        this.timer = null;
    }

    emit(win) {
        if (this.timer) this.clearTimeoutFn(this.timer);
        this.timer = this.setTimeoutFn(async () => {
            try {
                if (win && !win.isDestroyed()) {
                    const updatedLibrary = this.getSavedGames
                        ? await this.getSavedGames()
                        : [];
                    win.webContents.send(LIBRARY_UPDATED_CHANNEL, updatedLibrary);
                }
            } catch {}
        }, this.debounceMs);
    }

    cancel() {
        if (this.timer) {
            this.clearTimeoutFn(this.timer);
            this.timer = null;
        }
    }
}

module.exports = {
    LibraryUpdateEmitter,
    LIBRARY_UPDATED_CHANNEL,
};
