'use strict';

class SyncTerminalEventEmitter {
    constructor({
        getWindow,
        Notification,
    } = {}) {
        this.getWindow = getWindow;
        this.Notification = Notification;
    }

    emitCompleted(payload, notificationOptions = null) {
        const result = this._send('platform-sync:completed', payload);
        if (result.ok) {
            this._showCompletedNotification(result.win, notificationOptions);
        }
    }

    emitFailed(payload) {
        this._send('platform-sync:failed', payload);
    }

    _send(channel, payload) {
        try {
            const win = this.getWindow?.();
            if (win && !win.isDestroyed()) {
                win.webContents.send(channel, payload);
            }
            return { ok: true, win: win || null };
        } catch {
            return { ok: false, win: null };
        }
    }

    _showCompletedNotification(win, notificationOptions) {
        try {
            if (
                this.Notification &&
                notificationOptions &&
                this.Notification.isSupported() &&
                (!win || win.isDestroyed() || !win.isFocused())
            ) {
                new this.Notification(notificationOptions).show();
            }
        } catch {}
    }
}

module.exports = {
    SyncTerminalEventEmitter,
};
