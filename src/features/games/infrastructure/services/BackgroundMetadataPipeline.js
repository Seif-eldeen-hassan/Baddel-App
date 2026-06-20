'use strict';

const path = require('path');
const baddelApi = require('../../../../../services/baddelApi');
const { STATUS: MRM_STATUS } = require('../../../../../services/metadataResolutionManager');
const { generateMetadataCandidates } = require('../../../../../services/candidateGenerator');
const { mapPlatformHint: _mapPlatformHint } = require('../../../../shared/platform/platformHints');

/** Platforms that use the Steam/Epic server enrich flow — skip from this pipeline. */
const _SERVER_ENRICH_PLATFORMS = new Set(['steam', 'Steam', 'epic', 'Epic Games', 'epic games']);

// ── Background pipeline path helpers ─────────────────────────────────────────
// Prefer executablePath (the real binary) over game.path (install dir) or
// the potentially-quoted command string, so .lnk shortcuts never pollute the
// metadata candidate generator with a Desktop folder path.
function _metadataPathForGame(game) {
    return (
        game.executablePath ||
        game.launchCommand  ||
        (game.command || '').replace(/^"|"$/g, '').trim() ||
        game.path ||
        ''
    );
}

function _metadataFolderForGame(game) {
    if (game.folderName) return game.folderName;
    const p = _metadataPathForGame(game);
    if (!p) return undefined;
    try {
        const ext = path.extname(p).toLowerCase();
        // If p has an extension it's a file — use its parent dir name.
        // If no extension it's a directory — use the directory's own name.
        return ext ? path.basename(path.dirname(p)) : path.basename(p);
    } catch { return undefined; }
}

/**
 * Run the background metadata pipeline for all installed non-Steam/Epic games.
 * Safe to call multiple times — skips games that already have persisted metadata
 * less than 7 days old and skips games that are already covered by the server
 * enrich pipeline.
 *
 * @param {object[]} games  - array of installed game records from the DB
 * @param {object}   deps   - runtime deps: { engine, mrm, metadataCacheStore,
 *                            imageDownloadFn?, gameImageUpdatedFn? }
 */
async function runBackgroundMetadataPipeline(games, deps = {}) {
    const TAG = '[BackgroundMetaPipeline]';

    const _engine      = deps.engine;
    const _mrm         = deps.mrm;
    const _cache       = deps.metadataCacheStore;
    const _imgDownload = deps.imageDownloadFn    ?? null;
    const _imgNotifier = deps.gameImageUpdatedFn ?? null;

    // Filter: only non-Steam/Epic installed games
    const targets = games.filter(g => {
        const plat = (g.platform || '').trim();
        return !_SERVER_ENRICH_PLATFORMS.has(plat) && !g.isHidden;
    });

    if (targets.length === 0) {
        console.log(`${TAG} No non-Steam/Epic games to process. Pipeline skipped.`);
        return;
    }

    console.log(`${TAG} ══════ Pipeline START — ${targets.length} game(s) to process ══════`);

    let resolved = 0, mrmSkipped = 0, skipped = 0, missed = 0, recovered = 0;

    for (const game of targets) {
        const gameTag = `${TAG}[${game.name}]`;

        // ── Art presence helpers ──────────────────────────────────────────────
        const hasDiskCover = !!_engine.findInCache(game.id, 'cover');
        const hasDiskHero  = !!_engine.findInCache(game.id, 'hero');
        const hasDiskLogo  = !!_engine.findInCache(game.id, 'logo');
        const hasDbArt     = !!(game.image || game.heroImage || game.logo);
        const hasDiskArt   = hasDiskCover || hasDiskHero;
        const hasAnyArt    = hasDbArt || hasDiskArt;
        const hasDbHero    = !!game.heroImage;
        const hasHero      = hasDbHero || hasDiskHero;
        const hasDbLogo    = !!(game.logo || game.defaultLogo);
        const hasLogo      = hasDbLogo || hasDiskLogo;

        // ── RECOVERY: MRM says RESOLVED but game has no usable art ────────────
        // This happens when a prior pipeline run resolved metadata but the image
        // download or DB write then failed.  Without this reset the game is stuck
        // behind the 7-day RESOLVED lock even though its card is blank.
        const mrmStatus = _mrm.getStatus(game.id);
        if (mrmStatus === MRM_STATUS.RESOLVED && !hasAnyArt) {
            console.log(`${gameTag} ⚠ MRM RESOLVED but no usable art in DB/cache — resetting to IDLE`);
            _mrm.resetToIdle(game.id);
            await _cache.deleteEntry(game.id).catch(() => {});
            recovered++;
        }

        // ── Skip only when cover + hero + logo are all present + metadata cached ─
        // Any missing visual asset must NOT trigger a skip — backfill runs instead.
        try {
            if (hasAnyArt && hasHero && hasLogo && await _cache.hasEntry(game.id)) {
                console.log(`${gameTag} ↷ Has cached metadata + cover + hero + logo — skipping.`);
                skipped++;
                continue;
            }
        } catch { /* continue */ }

        // ── Hero backfill: cover/logo present but hero still missing ──────────
        // If cached metadata already has a hero URL we can download it directly
        // without triggering a full re-resolve.  If the cached metadata has no
        // hero URL the server had no hero data at that time — honour it and skip
        // until the 7-day metadata TTL expires and triggers a fresh resolve.
        if (hasAnyArt && !hasHero) {
            let heroHandled = false;
            try {
                const hasMeta = await _cache.hasEntry(game.id);
                if (hasMeta) {
                    console.log(`${gameTag} [HeroBackfill] missing hero but cover/logo present — retrying`);
                    const cachedMeta   = await _cache.load(game.id);
                    const cachedHeroUrl = cachedMeta?.heroImage || cachedMeta?.hero || null;
                    if (cachedHeroUrl) {
                        let finalHero = cachedHeroUrl;
                        if (_imgDownload) {
                            try {
                                const dl = await _imgDownload({ hero: cachedHeroUrl }, game.id);
                                if (dl?.hero) finalHero = dl.hero;
                                console.log(`${gameTag} [HeroBackfill] hero cached successfully (${finalHero})`);
                            } catch (e) {
                                console.warn(`${gameTag} [HeroBackfill] download failed, using remote URL:`, e.message);
                            }
                        }
                        try {
                            await _engine.updateGameMetadata(game.id, { hero: finalHero }, { source: 'pipeline' });
                            _engine.saveDatabase();
                            console.log(`${gameTag} [HeroBackfill] reused cached metadata hero — DB updated`);
                            if (_imgNotifier) {
                                const updatedGame = _engine.getGameById(game.id);
                                if (updatedGame) _imgNotifier(updatedGame);
                            }
                        } catch (e) {
                            console.warn(`${gameTag} [HeroBackfill] DB update failed:`, e.message);
                        }
                        heroHandled = true;
                    } else {
                        // Cache entry exists but has no hero — treat as stale/incomplete.
                        // Delete it and reset MRM so the full pipeline re-resolves fresh data.
                        console.log(`${gameTag} [IncompleteArtRecovery] cache has no hero/logo -> force refresh`);
                        await _cache.deleteEntry(game.id).catch(() => {});
                        _mrm.resetToIdle(game.id);
                        // heroHandled stays false → falls through to full resolve below
                    }
                }
                // No metadata cache entry → fall through to full pipeline
            } catch (e) {
                console.warn(`${gameTag} [HeroBackfill] error:`, e.message);
            }
            if (heroHandled) {
                await new Promise(r => setTimeout(r, 300));
                continue;
            }
        }

        // ── Logo backfill: hero present but logo still missing ────────────────
        // Runs only when hero is already resolved so we avoid a full re-resolve
        // just for a logo.  Reads from the cached metadata without network traffic.
        if (hasAnyArt && hasHero && !hasLogo) {
            try {
                const hasMeta = await _cache.hasEntry(game.id);
                if (hasMeta) {
                    const cachedMeta    = await _cache.load(game.id);
                    const cachedLogoUrl = cachedMeta?.logo || cachedMeta?.defaultLogo || null;
                    if (cachedLogoUrl && _imgDownload) {
                        const dl = await _imgDownload({ logo: cachedLogoUrl }, game.id);
                        const finalLogo = dl?.logo || cachedLogoUrl;
                        await _engine.updateGameMetadata(game.id, { logo: finalLogo }, { source: 'pipeline' });
                        _engine.saveDatabase();
                        console.log(`${gameTag} [IncompleteArtRecovery] backfilled logo (${finalLogo})`);
                        if (_imgNotifier) {
                            const upd = _engine.getGameById(game.id);
                            if (upd) _imgNotifier(upd);
                        }
                    }
                    await new Promise(r => setTimeout(r, 300));
                    continue;
                }
            } catch (e) {
                console.warn(`${gameTag} [IncompleteArtRecovery] logo backfill error:`, e.message);
            }
        }

        // ── Skip games only on active cooldown MRM state ──────────────────────
        const effectiveMrmStatus = _mrm.getStatus(game.id); // re-read after potential reset
        if (effectiveMrmStatus === MRM_STATUS.COOLDOWN) {
            const job = _mrm.getJob(game.id);
            console.log(`${gameTag} ↷ MRM cooldown until ${new Date(job?.cooldownUntil).toISOString()} — skipping.`);
            mrmSkipped++;
            continue;
        }

        // ── Route ALL resolution through MRM (Stage 1 DB + Stage 2 transient) ─
        // Use the centralized candidate generator so compact names like "ACMirage"
        // get camelCase-split + franchise-alias expansion.
        const metadataPath = _metadataPathForGame(game);
        const candidates = generateMetadataCandidates({
            name:       game.name,
            folderName: _metadataFolderForGame(game),
            exeName:    game.exeName || (metadataPath ? path.parse(metadataPath).name : undefined),
            pathHint:   metadataPath || undefined,
        });

        console.log(`${gameTag} MRM candidates: ${candidates.map(c => c.title || c.slug).join(', ')}`);

        // primary title = game.name (or first candidate's displayName)
        const primaryTitle = game.name || (candidates[0]?.title) || '';
        const { slug: _primarySlug } = (candidates[0] ? { slug: candidates[0].slug } : {});

        const resolveResult = await _mrm.resolve(game.id, {
            candidates,
            title:        primaryTitle,
            slug:         _primarySlug || undefined,
            platformHint: _mapPlatformHint(game.platform) || undefined,
        });

        const meta = resolveResult ? Object.assign({}, resolveResult.meta, { _resolveSource: resolveResult._resolveSource }) : null;

        // ── STEP 4: Persist metadata + cache assets + backfill DB ────────────
        if (meta) {
            // Use normalizeAssets to canonicalise cover/hero/logo regardless of
            // which alias the normalise functions returned (heroImage vs hero).
            const { cover: remoteCover, hero: remoteHero, logo: remoteLogo } =
                baddelApi.normalizeAssets(meta);

            try {
                await _cache.save(game.id, game.name, game.platform, meta);
                console.log(`${gameTag} ✓ Full metadata persisted to local cache`);
                resolved++;
            } catch (err) {
                console.warn(`${gameTag} Failed to persist metadata:`, err.message);
            }

            // ── Backfill cover/hero/logo into the game DB entry ──────────────
            let finalCover = remoteCover;
            let finalHero  = remoteHero;
            let finalLogo  = remoteLogo;

            if (_imgDownload) {
                try {
                    const assets = { cover: remoteCover, hero: remoteHero, logo: remoteLogo };
                    const cached = await _imgDownload(assets, game.id);
                    if (cached?.cover) finalCover = cached.cover;
                    if (cached?.hero)  finalHero  = cached.hero;
                    if (cached?.logo)  finalLogo  = cached.logo;
                    console.log(`${gameTag} ✓ Assets cached locally (cover=${!!finalCover} hero=${!!finalHero} logo=${!!finalLogo})`);
                } catch (err) {
                    console.warn(`${gameTag} Asset caching error (non-fatal) — using remote URLs:`, err.message);
                }
            }

            if (finalCover || finalHero || finalLogo) {
                try {
                    await _engine.updateGameMetadata(game.id, {
                        cover: finalCover,
                        hero:  finalHero,
                        logo:  finalLogo,
                    }, { source: 'pipeline' });
                    _engine.saveDatabase();
                    console.log(`${gameTag} ✓ DB entry backfilled (cover=${!!finalCover} hero=${!!finalHero} logo=${!!finalLogo})`);

                    if (_imgNotifier) {
                        const updatedGame = _engine.getGameById(game.id);
                        if (updatedGame) {
                            _imgNotifier(updatedGame);
                            console.log(`${gameTag} ✓ Renderer notified (game-image-updated)`);
                        }
                    }
                } catch (err) {
                    console.warn(`${gameTag} DB backfill error:`, err.message);
                }
            } else {
                // Metadata resolved (text / ratings) but no images at all.
                // Reset MRM so the next pipeline pass retries image fetching;
                // this keeps exception_keep_pending_art games in the retry loop.
                _mrm.resetToIdle(game.id);
                console.log(`${gameTag} ⚠ Resolved metadata has no images — MRM reset to IDLE for retry`);
            }
        } else {
            missed++;
            console.log(`${gameTag} ✗ No metadata found from any source`);
        }

        // Throttle: 300 ms between games to avoid hammering the server
        await new Promise(r => setTimeout(r, 300));
    }

    console.log(
        `${TAG} ══════ Pipeline END — resolved=${resolved} mrmSkipped=${mrmSkipped} ` +
        `cached=${skipped} missed=${missed} recovered=${recovered} ══════`
    );
}

module.exports = { runBackgroundMetadataPipeline };
