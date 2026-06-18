'use strict';

// ─── Games Feature — IPC Adapter ─────────────────────────────────────────────
//
// Routes IPC for the games feature. Two channels are now served by use cases:
//
//   get-game-by-id   → GetGameByIdUseCase   → GamesRepositoryImpl
//   get-hidden-games → GetHiddenGamesUseCase → GamesRepositoryImpl
//
// All other channels still delegate to legacy handlers unchanged.
//
// Duplicate-registration strategy
// ─────────────────────────────────
// gameLibraryHandlers.register() calls ipcMain.handle() for every channel it
// owns, including the two targets above.  To avoid double-registration we pass
// a thin ipcMain proxy to the legacy register call.  The proxy intercepts
// handle() calls for the two target channels, captures the legacy handler
// function for the shadow comparison, and silently drops the registration.
// All other handle() / on() calls pass through to the real ipcMain unchanged.
//
// IPC channels owned by this adapter (24 total):
//
//   Core library (gameLibraryHandlers):
//     remove-game, rename-game, scan-all-games, unhide-all-games,
//     get-hidden-games *, restore-specific-games, delete-game-permanently,
//     reorder-library, get-game-by-id *, get-dynamic-game-exes, add-manual-game
//
//   Library scan (installedGamesHandlers):
//     get-installed-games
//
//   Artwork / image cache (imageHandlers):
//     get-image-cache-dir-url-sync (ipcMain.on), cache-image, cache-all-assets,
//     prune-image-cache, select-game-image, probe-local-image,
//     get-image-cache-dir-url, get-cached-image, update-game-image, reset-game-image
//
//   Local metadata persistence (localMetadataHandlers):
//     save-game-metadata, save-full-metadata, load-full-metadata
//
//   (* now served by use cases; legacy handler captured for comparison only)

const gameLibraryHandlers    = require('../../../../../handlers/gameLibraryHandlers');
const installedGamesHandlers = require('../../../../../handlers/installedGamesHandlers');
const imageHandlers          = require('../../../../../handlers/imageHandlers');
const localMetadataHandlers  = require('../../../../../handlers/localMetadataHandlers');

const { GamesRepositoryImpl }    = require('../repositories/GamesRepositoryImpl');
const { GetGameByIdUseCase }     = require('../../application/useCases/GetGameByIdUseCase');
const { GetHiddenGamesUseCase }  = require('../../application/useCases/GetHiddenGamesUseCase');
const { ReorderLibraryUseCase }  = require('../../application/useCases/ReorderLibraryUseCase');
const { UnhideAllGamesUseCase }  = require('../../application/useCases/UnhideAllGamesUseCase');
const { RenameGameUseCase }             = require('../../application/useCases/RenameGameUseCase');
const { RestoreSpecificGamesUseCase }   = require('../../application/useCases/RestoreSpecificGamesUseCase');
const { RemoveGameUseCase }             = require('../../application/useCases/RemoveGameUseCase');

const INTERCEPTED = new Set(['get-game-by-id', 'get-hidden-games', 'reorder-library', 'unhide-all-games', 'rename-game', 'restore-specific-games', 'remove-game']);

/**
 * Register all games-feature IPC handlers.
 *
 * @param {Electron.IpcMain} ipcMain
 * @param {object}           deps   — merged deps bag passed from main.js
 */
module.exports.register = function registerGamesIpc(ipcMain, deps) {
    // ── Repository + use cases ────────────────────────────────────────────────
    const gamesRepository = new GamesRepositoryImpl({
        jsonGameRepository: deps.jsonGameRepository,
    });

    const getGameByIdUseCase          = new GetGameByIdUseCase(gamesRepository);
    const getHiddenGamesUseCase       = new GetHiddenGamesUseCase(gamesRepository);
    const reorderLibraryUseCase       = new ReorderLibraryUseCase(gamesRepository);
    const unhideAllGamesUseCase       = new UnhideAllGamesUseCase(gamesRepository);
    const renameGameUseCase           = new RenameGameUseCase(gamesRepository);
    const restoreSpecificGamesUseCase = new RestoreSpecificGamesUseCase(gamesRepository);
    const removeGameUseCase           = new RemoveGameUseCase(gamesRepository);

    // ── Capture map: channel → legacy handler (for shadow comparison) ─────────
    const legacyHandlers = {};

    // ── ipcMain proxy — intercepts the two target channels ────────────────────
    const ipcProxy = new Proxy(ipcMain, {
        get(target, prop) {
            if (prop !== 'handle') return Reflect.get(target, prop);
            return function handle(channel, fn) {
                if (INTERCEPTED.has(channel)) {
                    legacyHandlers[channel] = fn;
                    return; // drop registration; we register below
                }
                return target.handle(channel, fn);
            };
        },
    });

    // ── Register legacy handlers (proxy silently skips the two targets) ───────
    gameLibraryHandlers.register(ipcProxy, deps);
    installedGamesHandlers.register(ipcMain, deps);
    imageHandlers.register(ipcMain, deps);
    localMetadataHandlers.register(ipcMain, deps);

    // ── Register target channels via use cases ────────────────────────────────

    ipcMain.handle('get-game-by-id', async (event, gameId) => {
        const newResult = getGameByIdUseCase.execute(gameId);

        // Shadow comparison — runs async, never blocks or throws
        const legacy = legacyHandlers['get-game-by-id'];
        if (legacy) {
            Promise.resolve()
                .then(() => legacy(event, gameId))
                .then(legacyResult => {
                    const nId = newResult ? String(newResult.id) : null;
                    const lId = legacyResult ? String(legacyResult.id) : null;
                    if (nId !== lId) {
                        console.warn('[games.ipc] get-game-by-id mismatch — new:', nId, 'legacy:', lId);
                    }
                })
                .catch(err => console.warn('[games.ipc] get-game-by-id legacy comparison error:', err.message));
        }

        return newResult;
    });

    ipcMain.handle('get-hidden-games', async () => {
        const newResult = getHiddenGamesUseCase.execute();

        // Shadow comparison — runs async, never blocks or throws
        const legacy = legacyHandlers['get-hidden-games'];
        if (legacy) {
            Promise.resolve()
                .then(() => legacy())
                .then(legacyResult => {
                    const newLen    = Array.isArray(newResult)    ? newResult.length    : -1;
                    const legacyLen = Array.isArray(legacyResult) ? legacyResult.length : -1;
                    if (newLen !== legacyLen) {
                        console.warn('[games.ipc] get-hidden-games mismatch — new len:', newLen, 'legacy len:', legacyLen);
                    }
                })
                .catch(err => console.warn('[games.ipc] get-hidden-games legacy comparison error:', err.message));
        }

        return newResult;
    });

    // reorder-library is mutating; legacy shadow comparison is intentionally disabled
    // to avoid double writes — running legacy after the use case would reorder and
    // persist the DB a second time with identical data, causing unnecessary I/O and
    // making the operation non-idempotent from a timing perspective.
    ipcMain.handle('reorder-library', async (_, ids) => {
        return reorderLibraryUseCase.execute(ids);
    });

    // unhide-all-games is mutating; legacy shadow comparison is intentionally disabled
    // to avoid double writes — running legacy after the use case would clear hidden flags
    // and persist the DB a second time unnecessarily.
    ipcMain.handle('unhide-all-games', async () => {
        return unhideAllGamesUseCase.execute();
    });

    // rename-game is mutating; legacy shadow comparison is intentionally disabled
    // to avoid double writes — running legacy after the use case would rename/save twice.
    ipcMain.handle('rename-game', async (_, gameId, newName) => {
        // Validation preserved verbatim from legacy gameLibraryHandlers
        try {
            deps.ipcValidation.assertSafeId(gameId, 'id');
            deps.ipcValidation.assertString(newName, 'name', 256);
        } catch (e) { return deps.ipcValidation.sanitizeErrorForRenderer(e); }
        return renameGameUseCase.execute(gameId, newName);
    });

    // restore-specific-games is mutating; legacy shadow comparison is intentionally disabled
    // to avoid double writes — running legacy after the use case would un-hide games twice.
    // Analytics preserved verbatim from legacy handler at IPC boundary (not in use case / repo).
    ipcMain.handle('restore-specific-games', async (_, ids) => {
        const result = await restoreSpecificGamesUseCase.execute(ids);
        if (result && result.status === 'success') {
            deps.analytics.logGameRestored(ids.length).catch(() => {});
        }
        return result;
    });

    // remove-game is mutating; legacy shadow comparison is intentionally disabled to avoid
    // double writes — running legacy after the use case would hide/save the game record twice.
    // getSavedGames + _detectPlatform are used at the IPC boundary only for analytics;
    // they do not belong in the use case or repository.
    // Analytics fires unconditionally after removeGame (not conditioned on result.status),
    // preserving exact legacy behavior.
    ipcMain.handle('remove-game', async (_, id) => {
        try { deps.ipcValidation.assertSafeId(id, 'id'); } catch (e) { return deps.ipcValidation.sanitizeErrorForRenderer(e); }
        const games = await deps.getSavedGames();
        const game = games.find(g => g.id === id);
        const platform = deps._detectPlatform(game && game.command);
        const result = await removeGameUseCase.execute(id);
        deps.analytics.logGameRemoved(platform).catch(() => {});
        return result;
    });
};
