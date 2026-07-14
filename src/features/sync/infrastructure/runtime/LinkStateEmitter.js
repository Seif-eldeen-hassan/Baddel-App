'use strict';

const LINK_STATE_CHANNEL = 'platform-sync:link-state-changed';

class LinkStateEmitter {
    emit(mainWindow, platform, status, message, extra = {}) {
        try {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send(LINK_STATE_CHANNEL, {
                    platform,
                    status,
                    message,
                    ...extra,
                });
            }
        } catch {}
    }
}

module.exports = {
    LinkStateEmitter,
    LINK_STATE_CHANNEL,
};
