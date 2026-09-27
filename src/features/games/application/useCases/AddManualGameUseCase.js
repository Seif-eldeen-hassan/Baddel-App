'use strict';

const path = require('path');

const VERBOSE_LOGS = process.env.BADDEL_VERBOSE_LOGS === '1';
function verboseLog(...args) { if (VERBOSE_LOGS) console.log(...args); }

/**
 * Adds a manually-specified game to the library.
 *
 * All side-effect owners (FS, MRM, DB, image download) are injected so the
 * function can be unit-tested without Electron or a real database.
 *
 * @param {object}        params
 * @param {string}        params.launchPath
 * @param {string|null}   [params.customName]
 * @param {Function|null} [params.notifyCallback]
 * @param {object}        [params.options]
 * @param {object}        params.fs                        - require('fs').promises
 * @param {object}        params.fsSync                    - require('fs')
 * @param {Function}      params.generateStableId          - (input) => string
 * @param {Function}      params.parseShortcutArgs         - (args) => parsed
 * @param {Function}      params.generateMetadataCandidates
 * @param {object}        params.gamesRepository           - JsonGameRepository
 * @param {object}        params.metadataResolutionManager - MRM instance
 * @param {object}        params.metadataStatus            - MRM STATUS constants
 * @param {object}        params.metadataCacheStore
 * @param {Function}      params.upsertGame                - async (game) => void
 * @param {Function}      params.saveDatabase              - () => void
 * @param {Function}      params.getGameById               - (id) => game | null
 * @param {Function}      params.backgroundDownload        - (meta, id, cb, opts) => Promise
 * @returns {Promise<{status: string, game?: object, message?: string}>}
 */
async function addManualGame({
    launchPath,
    customName = null,
    notifyCallback = null,
    options = {},

    fs,
    fsSync,
    generateStableId,
    parseShortcutArgs,
    generateMetadataCandidates,

    gamesRepository,
    metadataResolutionManager,
    metadataStatus,
    metadataCacheStore,

    upsertGame,
    saveDatabase,
    getGameById,
    backgroundDownload,
}) {
    const lnkTarget     = options?.lnkTarget    || null;
    const metadataPath  = options?.metadataPath || lnkTarget || launchPath;
    const shortcutArgs  = options?.shortcutArgs || '';
    const shortcutCwd   = options?.shortcutCwd  || null;
    const forceMetadata = options?.forceMetadata === true || options?.force === true;

    try {
        const stats = await fs.stat(launchPath);
        if (!stats.isFile()) return { status: 'error', message: 'File not found' };

        // effectivePath is the real executable (or lnk target) used for
        // metadata — never a Desktop .lnk path.
        const effectivePath  = metadataPath;
        const rawExeStem     = path.parse(effectivePath).name;
        const exeName        = rawExeStem.replace(/[-_]/g, ' ').trim();
        const parentFolder   = path.basename(path.dirname(effectivePath)).replace(/[-_]/g, ' ').trim();

        // Compute stable ID from effectivePath so the same game reached via
        // different .lnk shortcuts doesn't create duplicate DB entries.
        const tempId = generateStableId({ command: effectivePath, name: customName || exeName });

        // ── Duplicate / re-add check ───────────────────────────────────────
        const existing = gamesRepository.findManualGameByPaths(launchPath, effectivePath);
        if (existing) {
            if (existing.isHidden) { existing.isHidden = false; saveDatabase(); }
            return { status: 'success', game: existing };
        }

        const primaryTitle = customName || parentFolder || exeName;

        // Build slug helper for MRM candidates
        const _toSlug = str => (str || '').toLowerCase()
            .replace(/[''`™®©]/g, '')
            .replace(/[^a-z0-9\s-]/g, ' ')
            .replace(/\s+/g, '-')
            .replace(/-{2,}/g, '-')
            .replace(/^-+|-+$/g, '');

        // Build MRM candidates using effectivePath so a Desktop .lnk doesn't
        // mislead camelCase splitting or franchise alias expansion.
        const mrmCandidates = generateMetadataCandidates({
            name:       customName || parentFolder,
            folderName: parentFolder,
            exeName:    rawExeStem,
            pathHint:   effectivePath,
        });

        // ── Route ALL resolution through MRM ──────────────────────────────
        let finalMetadata = null;
        let finalName     = primaryTitle;
        let validationDeferred = false;

        const mrmStatus = metadataResolutionManager.getStatus(tempId);

        if (mrmStatus === metadataStatus.COOLDOWN && !forceMetadata) {
            console.log(`[Manual Add] MRM cooldown active for "${primaryTitle}" — deferred`);
            validationDeferred = true;
        } else {
            verboseLog(`[Manual Add] MRM candidates for "${primaryTitle}": ${mrmCandidates.map(c => c.title || c.slug).join(', ')}`);
            const resolveResult = await metadataResolutionManager.resolve(tempId, {
                candidates:  mrmCandidates,
                title:       primaryTitle,
                slug:        _toSlug(primaryTitle) || undefined,
                exeName:     exeName      || undefined,
                folderName:  parentFolder || undefined,
                pathHint:    effectivePath || undefined,
                force:       forceMetadata || undefined,
                bypassTtl:   forceMetadata || undefined,
            });

            if (resolveResult) {
                finalMetadata = resolveResult.meta;
                if (!customName) finalName = resolveResult.matchedName || primaryTitle;
                console.log(`[Manual Add] ✓ MRM resolved "${primaryTitle}" via ${resolveResult._resolveSource}`);
            } else {
                if (metadataResolutionManager.getStatus(tempId) === metadataStatus.COOLDOWN && !forceMetadata) {
                    console.warn(`[Manual Add] MRM entered cooldown for "${primaryTitle}" — deferred`);
                    validationDeferred = true;
                }
            }
        }

        const isLnk = launchPath.toLowerCase().endsWith('.lnk');
        // installDir is the real game folder, never the Desktop / shortcut folder
        const installDir = fsSync.existsSync(effectivePath)
            ? path.dirname(effectivePath)
            : path.dirname(launchPath);

        const newGame = {
            id:              tempId,
            name:            finalName,
            command:         launchPath,
            shortcutPath:    isLnk ? launchPath : null,
            path:            installDir,
            executablePath:  effectivePath,
            folderName:      parentFolder,
            exeName:         rawExeStem,
            launchArgs:      parseShortcutArgs(shortcutArgs),
            launchCwd:       shortcutCwd || installDir,
            rawShortcutArgs: shortcutArgs || '',
            scannerPlatform: 'manual',
            installSource:   'manual',
            isInstalled:     true,
            platform:        'Manual',
            image:     finalMetadata?.cover     || finalMetadata?.image     || null,
            heroImage: finalMetadata?.heroImage || finalMetadata?.hero      || null,
            logo:      finalMetadata?.logo                                  || null,
            score:     100,
            isHidden:  false,
            addedAt:   new Date().toISOString(),
            ...(validationDeferred ? {
                needsValidation:    true,
                validationDeferred: true,
                validationReason:   'manual_add_rate_limited',
            } : {}),
        };

        await upsertGame(newGame);
        saveDatabase();

        // ── Persist full structured metadata immediately ───────────────────
        // game-details.js reads from metadataCacheStore via loadFullMetadata().
        // Without this call the details page has no description, screenshots,
        // ratings, etc. even though the card already shows the poster.
        if (finalMetadata) {
            metadataCacheStore.save(tempId, finalName, 'Manual', finalMetadata)
                .catch(err => console.warn('[Manual Add] Failed to persist full metadata:', err.message));
        }

        // Download images to local WebP cache before returning so the
        // renderer receives a game with file:// cover/hero/logo already set.
        if (finalMetadata) {
            await backgroundDownload(finalMetadata, tempId, notifyCallback, { source: 'addManual' });
        }
        const hydratedGame = getGameById(tempId) || newGame;
        return { status: 'success', game: hydratedGame };
    } catch (err) {
        console.error('[Manual Add]', err);
        return { status: 'error', message: err.message };
    }
}

module.exports = { addManualGame };
