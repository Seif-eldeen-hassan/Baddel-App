'use strict';

// Baddel server API IPC handlers extracted from main.js.
// All behaviour is verbatim — only outer-scope references are threaded through deps.
//
// deps shape: { baddelApi }
//
// Not moved here:
//   get-game-metadata  — tightly coupled to MetadataResolutionManager and local Steam/Epic pipeline
//   save-game-metadata / save-full-metadata / load-full-metadata — part of the local metadata store
//   playtime / achievements handlers — unrelated domain

module.exports.register = function registerBaddelApiHandlers(ipcMain, deps) {
    const { baddelApi } = deps;

    // ── Baddel Server IPC Handlers ──────────────────────────────
    //
    // 'lookup-game-server'   → look up game in Baddel DB, returns normalized meta or null
    // 'enrich-game-server'   → trigger background enrichment for a game UUID
    //
    ipcMain.handle('baddelapi-cooldown-active', () => baddelApi.isCooldownActive());

    ipcMain.handle('lookup-game-server', async (_, query) => {
        try {
            const serverGame = await baddelApi.lookupGame(query);
            const normalized = serverGame ? baddelApi.normalizeServerData(serverGame) : null;
            return normalized;
        } catch (err) {
            console.warn('[BaddelAPI IPC] lookup failed:', err.message);
            return null;
        }
    });

    ipcMain.handle('enrich-game-server', async (_, gameId, clientData) => {
        // NOTE: gameId here is the server UUID (from _serverData.id).
        // We look it up to get the platform + external id, then use requestGameEnrich.
        // The renderer (game-details.js) now owns the poll loop — we just fire the
        // enrich request once and return.  No background polling loop here to avoid
        // duplicate request-enrich calls and stale game-enriched events arriving after
        // the user has already navigated to a different game.
        try {
            // Lookup by UUID to find platform info
            const existing = await baddelApi.lookupGame({ uuid: gameId }).catch(() => null);
            if (!existing) return { status: 'not_found' };

            const platformId = existing.platform_ids?.[0];
            const platform   = platformId?.platform || null;
            const extId      = platformId?.external_id || null;

            if (platform && extId) {
                // Single fire-and-forget enrich request — no retries, no poll loop
                baddelApi.requestGameEnrich(platform, extId, existing.title || null).catch(() => {});
            }

            return { status: 'accepted' };
        } catch (err) {
            console.warn('[BaddelAPI IPC] enrich-game-server failed:', err.message);
            return null;
        }
    });

    // ── Transient metadata resolver for non-Steam/Epic games ────────────────────
    // Called from renderer (game-details.js) via preload's resolveMetadataServer().
    // Proxies to baddelApi.resolveMetadata() and returns the full result object
    // so the renderer can call normalizeTransientData on the meta field.
    ipcMain.handle('resolve-metadata', async (_, params) => {
        try {
            console.log('[resolve-metadata IPC] START params:', JSON.stringify(params));
            const result = await baddelApi.resolveMetadata(params);
            const status = result?.status;
            console.log(`[resolve-metadata IPC] status="${status}" title="${result?.meta?.title || result?.data?.title || '—'}"`);
            return result;
        } catch (err) {
            console.warn('[resolve-metadata IPC] error:', err.message);
            return null;
        }
    });

    ipcMain.handle('import-and-enrich-server', async (_, { platform, game }) => {
        // Guard: only Steam and Epic are eligible for server enrich in this release.
        const SUPPORTED = ['steam', 'epic'];
        if (!SUPPORTED.includes(platform)) {
            console.log(`[BaddelAPI IPC] import-and-enrich-server — platform "${platform}" not supported, skipping.`);
            return null;
        }
        try {
            const id    = String(game.id || game.namespace || '');
            const title = game.title || null;
            if (!id) {
                console.warn('[BaddelAPI IPC] import-and-enrich-server — empty id, skipping.');
                return null;
            }
            console.log(`[BaddelAPI IPC] import-and-enrich-server — platform=${platform} id=${id} title="${title}"`);
            await baddelApi.requestGameEnrich(platform, id, title);
            return { _serverData: { pending: true, platform, externalId: id }, source: 'server-pending', info: { screenshots: [], artworks: [], allTrailers: [] } };
        } catch (err) {
            console.warn('[BaddelAPI IPC] import-and-enrich-server failed:', err.message);
            return null;
        }
    });
};
