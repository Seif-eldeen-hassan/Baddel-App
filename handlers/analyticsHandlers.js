'use strict';

// Analytics-related IPC handlers extracted from main.js.
// All behaviour is verbatim — only outer-scope references are threaded through deps.
//
// deps shape: { analytics, fs, app }
//   fs  — require('fs').promises  (used by get-consent-shown / set-consent-shown)
//   app — Electron app object     (used to compute consent-flag file path)

module.exports.register = function registerAnalyticsHandlers(ipcMain, deps) {
    const { analytics, fs, app } = deps;

    // Computed once per registration — path never changes after app is ready.
    const CONSENT_SHOWN_FILE = require('path').join(
        app.getPath('userData'), 'analytics_consent_shown.json'
    );

    // ---- Analytics Consent ----
    ipcMain.handle('analytics-grant-consent',  () => analytics.grantConsent());
    ipcMain.handle('analytics-revoke-consent', () => analytics.revokeConsent());
    ipcMain.handle('analytics-is-enabled',     () => analytics.isConsentGiven());

    // ---- Consent Shown Flag (disk-based — survives app restarts) ----
    ipcMain.handle('get-consent-shown', async () => {
        try {
            await fs.access(CONSENT_SHOWN_FILE);
            return true;
        } catch {
            return false;
        }
    });
    ipcMain.handle('set-consent-shown', async () => {
        await fs.writeFile(CONSENT_SHOWN_FILE, JSON.stringify({ shown: true }), 'utf8');
    });

    ipcMain.handle('analytics-log-game-spin',  (_, isCustom) => {
            analytics.logGameSpinClicked(isCustom).catch(() => {});
    });

    ipcMain.handle('analytics-log-hud-sensor', (_, isEnabled) => {
        analytics.logHudSensorToggled(isEnabled).catch(() => {});
    });

    ipcMain.handle('analytics-log-image-changed', (_, type, isReset) => {
        analytics.logGameImageChanged(type, isReset).catch(() => {});
    });

    ipcMain.handle('analytics-log-feedback', () => {
        analytics.logFeedbackSent().catch(() => {});
    });
};
