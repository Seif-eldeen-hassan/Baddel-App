'use strict';

// Update-notes IPC handlers extracted from main.js.
// All behaviour is verbatim — only outer-scope references are threaded through deps.
//
// deps shape: { getPendingUpdateNotesPayload, markUpdateNotesShown, app }
//
// Note: the auto-updater state machine, setupAutoUpdater(), and all
// update-found/update-ready/update-error event logic are NOT moved here —
// they remain in main.js.

module.exports.register = function registerUpdateNotesHandlers(ipcMain, deps) {
    const { getPendingUpdateNotesPayload, markUpdateNotesShown, app } = deps;

    // ── Update notes IPC ──────────────────────────────────────────────────────
    ipcMain.handle('get-pending-update-notes', () => {
        try {
            return { status: 'success', notes: getPendingUpdateNotesPayload() };
        } catch (err) {
            console.warn('[UpdateNotes] get failed:', err?.message || err);
            return { status: 'error', message: err?.message || String(err), notes: null };
        }
    });

    ipcMain.handle('mark-update-notes-shown', (_event, version) => {
        try {
            markUpdateNotesShown(version || app.getVersion());
            return { status: 'success' };
        } catch (err) {
            return { status: 'error', message: err?.message || String(err) };
        }
    });
};
