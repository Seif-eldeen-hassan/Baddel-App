'use strict';

// get-game-metadata IPC handler extracted from main.js.
// All behaviour is verbatim — only outer-scope references are threaded through deps.
//
// deps shape:
//   { baddelApi,               ← services/baddelApi (module-level require in main.js)
//     mrm,                     ← require('./gameScanner').resolutionManager
//     generateMetadataCandidates } ← services/candidateGenerator

module.exports.register = function registerGameMetadataHandlers(ipcMain, deps) {
    const { baddelApi, mrm, generateMetadataCandidates } = deps;

    // ─── Platform hint mapper ──────────────────────────────────────────────────
    // Maps raw launcher platform strings to the server-accepted `platformHint` values
    // for POST /client/resolve-metadata.  Unknown values return null (field omitted).
    function _mapPlatformHint(raw) {
        if (!raw) return null;
        const p = raw.toLowerCase().trim();
        if (p === 'xbox' || p === 'xbox game pass' || p === 'microsoft store' || p === 'store') return 'xbox';
        if (p === 'ea app' || p === 'ea' || p === 'origin')                                     return 'ea';
        if (p === 'ubisoft connect' || p === 'ubisoft')                                          return 'ubisoft';
        if (p === 'riot games' || p === 'riot')                                                  return 'riot';
        if (p === 'rockstar' || p === 'rockstar games')                                          return 'rockstar';
        if (p === 'gog')                                                                         return 'gog';
        if (p === 'battlenet' || p === 'battle.net')                                             return 'battlenet';
        return null; // steam/epic never reach this path; unknown → omit field
    }

    function _canonicalSteamEpicId(platform, hints = {}) {
        const p = String(platform || '').toLowerCase().trim();

        if (p === 'steam') {
            const raw =
                hints.allIds?.steam ||
                hints.appid ||
                hints.appId ||
                hints.steamAppId ||
                hints.id;

            const cleaned = String(raw || '')
                .replace(/^steam[-_]/i, '')
                .trim();

            return /^\d+$/.test(cleaned) ? cleaned : null;
        }

        if (p === 'epic') {
            const raw =
                hints.allIds?.epic ||
                hints.namespace ||
                hints.catalogNamespace ||
                hints.epicNamespace;

            const cleaned = String(raw || '')
                .replace(/^epic[-_]/i, '')
                .trim();

            if (cleaned.length >= 10 && /^[a-z0-9-]+$/i.test(cleaned)) {
                return cleaned;
            }

            return null;
        }

        return null;
    }

    // ---- Metadata ----
    // All metadata now comes from Baddel API server
    ipcMain.handle('get-game-metadata', async (_, originalGameName, hints = {}) => {
        try {
            let platform = (hints.platform || '').toLowerCase().trim();
            let id = hints.id || null;

            // Normalize platform aliases
            if (platform === 'steam_app') platform = 'steam';
            if (platform === 'epic' || platform === 'epic games' || platform === 'epic_games') platform = 'epic';

            // ── Steam / Epic path: lookup → enrich-request → server-pending ──────
            const STEAM_EPIC = new Set(['steam', 'epic']);

            const canonicalId = _canonicalSteamEpicId(platform, {
                ...hints,
                id
            });

            if (platform && canonicalId && STEAM_EPIC.has(platform)) {
                console.log(`[get-game-metadata] Steam/Epic canonical lookup: ${platform}/${canonicalId}`);

                let serverGame = await baddelApi.lookupGame({
                    platform,
                    id: canonicalId
                });

                if (!serverGame) {
                    console.log(`[get-game-metadata] Steam/Epic miss — requesting enrich for ${platform} ID: ${canonicalId}`);

                    baddelApi
                        .requestGameEnrich(platform, canonicalId, originalGameName)
                        .catch(() => {});

                    return {
                        _serverData: {
                            pending: true,
                            platform,
                            externalId: canonicalId
                        },
                        source: 'server-pending',
                        info: {
                            screenshots: [],
                            artworks: [],
                            allTrailers: []
                        }
                    };
                }

                console.log(`[get-game-metadata] Steam/Epic hit: ${platform}/${canonicalId}`);
                return baddelApi.normalizeServerData(serverGame);
            }

            // ── Platform/ID pre-lookup for Ubisoft/EA/Xbox games that also have Epic or Steam IDs ──
            // Games like Rainbow Six Siege have platform='ubisoft' but launch via Epic.
            // The early STEAM_EPIC check above is skipped because platform !== 'epic'.
            // Try a direct platform/id lookup using allIds, namespace, or launcherGameId before MRM.
            {
                const epicId = hints.allIds?.epic
                    || hints.namespace
                    || (typeof (hints.id || '') === 'string' && /^epic[-_]/i.test(hints.id || '') ? String(hints.id).replace(/^epic[-_]/i, '') : null);
                if (epicId) {
                    const cleanEpicId = String(epicId).replace(/^epic[-_]/i, '');
                    console.log(`[get-game-metadata] trying platform/id lookup: epic/${cleanEpicId}`);
                    try {
                        const hit = await baddelApi.lookupGame({ platform: 'epic', id: cleanEpicId });
                        if (hit) {
                            console.log(`[get-game-metadata] platform/id hit: epic/${cleanEpicId}`);
                            return baddelApi.normalizeServerData(hit);
                        }
                        console.log(`[get-game-metadata] platform/id miss: epic/${cleanEpicId}`);
                    } catch (_e) { /* continue to MRM */ }
                }

                const steamId = hints.allIds?.steam
                    || (typeof (hints.id || '') === 'string' && /^steam[-_]/i.test(hints.id || '') ? String(hints.id).replace(/^steam[-_]/i, '') : null);
                if (steamId) {
                    const cleanSteamId = String(steamId).replace(/^steam[-_]/i, '');
                    console.log(`[get-game-metadata] trying platform/id lookup: steam/${cleanSteamId}`);
                    try {
                        const hit = await baddelApi.lookupGame({ platform: 'steam', id: cleanSteamId });
                        if (hit) {
                            console.log(`[get-game-metadata] platform/id hit: steam/${cleanSteamId}`);
                            return baddelApi.normalizeServerData(hit);
                        }
                        console.log(`[get-game-metadata] platform/id miss: steam/${cleanSteamId}`);
                    } catch (_e) { /* continue to MRM */ }
                }
            }

            // ── Non-Steam/Epic: route through unified MetadataResolutionManager ──────
            // (Riot, EA, Ubisoft, Xbox, Manual, etc.)
            // MRM deduplicates inflight calls, enforces cooldown / not_found / ambiguous
            // state, and persists outcomes across restarts — preventing retry storms.

            const _toSlug = str => (str || '')
                .toLowerCase().trim()
                .replace(/['''ʼ＇'`™®©]/g, '').replace(/[^a-z0-9\s\-]/g, ' ')
                .replace(/\s+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');

            // hints.id is the game's internal DB id (MD5) for non-Steam/Epic entries.
            // Fall back to an anonymous key if somehow absent.
            const gameId  = hints.id || null;
            const mrmKey  = gameId || `anon:${_toSlug(originalGameName)}`;

            const forceMetadata =
                hints.force      === true ||
                hints.bypassTtl  === true ||
                hints.ignoreTtl  === true ||
                hints.source === 'manual-add-readd' ||
                hints.source === 'manual-add';

            // Gate on terminal / cooldown MRM states before any network calls.
            if (mrm) {
                const mrmStatus = mrm.getStatus(mrmKey);
                if (!forceMetadata && mrmStatus === 'cooldown') {
                    const job = mrm.getJob(mrmKey);
                    console.log(`[get-game-metadata] MRM cooldown for "${originalGameName}" until ${new Date(job?.cooldownUntil).toISOString()}`);
                    return { _mrmStatus: 'cooldown', _cooldownUntil: job?.cooldownUntil };
                }
                // NOTE: NOT_FOUND / AMBIGUOUS are NOT blocked here — MRM.resolve() itself
                // will detect whether the candidate signature has changed and retry if so.
            }

            // Build MRM candidates using the centralized generator so camelCase splitting
            // and franchise alias expansion (e.g. ACMirage → Assassin's Creed Mirage) apply.
            const rawPathHint = hints.pathHint || hints.path || hints.command || null;
            const mrmCandidates = generateMetadataCandidates({
                name:       originalGameName,
                exeName:    hints.exeName    || undefined,
                folderName: hints.folderName || undefined,
                pathHint:   rawPathHint      || undefined,
            });

            const slug = (mrmCandidates[0]?.slug) || (originalGameName || '')
                .toLowerCase().trim()
                .replace(/['''ʼ＇'`™®©]/g, '').replace(/[^a-z0-9\s\-]/g, ' ')
                .replace(/\s+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');

            if (mrm) {
                console.log(`[get-game-metadata] MRM candidates for "${originalGameName}": ${mrmCandidates.map(c => c.title || c.slug).join(', ')}`);
                console.log(`[get-game-metadata] candidate aliases: ${mrmCandidates.map(c => `${c.title || ''}${c.slug ? ` (${c.slug})` : ''}`).join(' | ')}`);
                console.log(`[get-game-metadata] Routing "${originalGameName}" through MRM (key=${mrmKey})`);
                const resolveResult = await mrm.resolve(mrmKey, {
                    candidates:   mrmCandidates,
                    title:        originalGameName,
                    slug:         (slug && slug.length >= 3) ? slug : undefined,
                    platformHint: _mapPlatformHint(hints.platform) || undefined,
                    exeName:      hints.exeName    || undefined,
                    folderName:   hints.folderName || undefined,
                    pathHint:     rawPathHint      || undefined,
                    force:        forceMetadata    || undefined,
                    bypassTtl:    forceMetadata    || undefined,
                });
                if (resolveResult) {
                    resolveResult.meta._resolveSource = resolveResult._resolveSource;
                    return resolveResult.meta;
                }
                return null;
            }

            // Fallback if MRM is not available (should not happen in production)
            return null;
        } catch (err) {
            console.warn('[get-game-metadata] Error:', err.message);
            return null;
        }
    });
};
