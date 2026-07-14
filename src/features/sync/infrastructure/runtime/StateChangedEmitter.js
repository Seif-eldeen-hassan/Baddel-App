'use strict';

class StateChangedEmitter {
    constructor({ getWindow } = {}) {
        this.getWindow = getWindow;
    }

    emit(payload) {
        try {
            const win = this.getWindow?.();
            if (win && !win.isDestroyed()) {
                win.webContents.send('platform-sync:state', payload);
            }
        } catch {}
    }
}

module.exports = {
    StateChangedEmitter,
};
