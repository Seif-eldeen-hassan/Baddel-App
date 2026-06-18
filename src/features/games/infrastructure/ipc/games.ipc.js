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

const INTERCEPTED = new Set(['get-game-by-id', 'get-hidden-games']);

/**
 * Register all games-feature IPC handlers.
 *
 * @param {Electron.IpcMain} ipcMain
 * @param {object}           deps   — merged deps bag passed from main.js
 */
module.exports.register = function registerGamesIpc(ipcMain, deps) {
    // ── Repository + use cases ────────────────────────────────────────────────
    const gamesRepository = new GamesRepositoryImpl({
        getSavedGames:  deps.getSavedGames,
        getHiddenGames: deps.getHiddenGames,
    });

    const getGameByIdUseCase    = new GetGameByIdUseCase(gamesRepository);
    const getHiddenGamesUseCase = new GetHiddenGamesUseCase(gamesRepository);

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
};
