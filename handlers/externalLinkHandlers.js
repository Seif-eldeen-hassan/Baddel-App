'use strict';

// External-link IPC handlers extracted from main.js.
// All behaviour is verbatim — only outer-scope references are threaded through deps.
//
// deps shape: { shell, ipcValidation, safeLauncher }
//
// Note: launcher:open-install-url is intentionally kept in main.js because its
// helper functions (_launcherIsRunning, _openProtocolUrlReliable, etc.) are
// shared with the launch-game handler and cannot be split without touching it.

// Strict domain allowlist for official community/social links.
// Moved verbatim from main.js — only consumed by open-community-url.
const _COMMUNITY_ALLOWED_DOMAINS = new Set([
    'discord.gg',
    'instagram.com',
    'www.instagram.com',
    'x.com',
    'www.x.com',
    'linkedin.com',
    'www.linkedin.com',
    'tiktok.com',
    'www.tiktok.com',
]);
const BADDEL_SUPPORT_URL = 'https://ko-fi.com/baddel';

module.exports.register = function registerExternalLinkHandlers(ipcMain, deps) {
    const { shell, ipcValidation, safeLauncher } = deps;

    ipcMain.handle('open-external-url', async (_event, url) => {
        try {
            ipcValidation.assertString(url, 'url', 2048);
            await safeLauncher.openProtocolUrl(url);
        } catch (err) {
            console.warn('[Security] open-external-url blocked:', String(url || '').slice(0, 80), err.message);
            return ipcValidation.sanitizeErrorForRenderer(err, 'Protocol not allowed.');
        }
    });

    // ── Community Hub: strict domain allowlist for official social links ──────────
    ipcMain.handle('open-community-url', async (_event, url) => {
        try {
            ipcValidation.assertString(url, 'url', 2048);
            let parsed;
            try { parsed = new URL(String(url)); } catch {
                const e = new Error('Invalid URL');
                e.code = 'INVALID_URL';
                throw e;
            }
            if (parsed.protocol !== 'https:') {
                const e = new Error(`Only https allowed, got: ${parsed.protocol}`);
                e.code = 'PROTOCOL_NOT_ALLOWED';
                throw e;
            }
            const host = parsed.hostname.toLowerCase();
            if (!_COMMUNITY_ALLOWED_DOMAINS.has(host)) {
                const e = new Error(`Domain not allowed: ${host}`);
                e.code = 'DOMAIN_NOT_ALLOWED';
                throw e;
            }
            await shell.openExternal(url);
            return { status: 'success' };
        } catch (err) {
            console.warn('[Community] open-community-url blocked:', String(url || '').slice(0, 80), err.message);
            return ipcValidation.sanitizeErrorForRenderer(err, 'URL not allowed.');
        }
    });

    ipcMain.handle('open-baddel-support', async () => {
        try {
            await shell.openExternal(BADDEL_SUPPORT_URL);
            return { status: 'success' };
        } catch (err) {
            console.warn('[Support] open-baddel-support failed:', err.message);
            return ipcValidation.sanitizeErrorForRenderer(err, 'Could not open Baddel support.');
        }
    });
};

module.exports.BADDEL_SUPPORT_URL = BADDEL_SUPPORT_URL;
