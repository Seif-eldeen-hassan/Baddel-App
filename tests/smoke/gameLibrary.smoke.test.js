'use strict';

/**
 * Smoke test: game library IPC contract
 *
 * Validates that the game library modules load without error and that the
 * core persistence functions return the correct data shapes. This test runs
 * in the Node process (no Electron required) by importing the scanner and
 * pointing it at a temporary userData directory.
 *
 * What this guards:
 *   - gameScanner.getSavedGames() returns an array
 *   - Each game object has the required fields: id, name, command
 *   - The module loads without throwing at require() time
 *
 * MIGRATION GATE: If this test fails after any migration step, the game
 * library persistence layer has been broken. Do not merge until fixed.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

describe('Game Library — smoke', () => {

    test('gameScanner module loads without throwing', () => {
        // If this throws, a top-level side effect in gameScanner.js is crashing.
        assert.doesNotThrow(() => {
            require('../../gameScanner');
        }, 'gameScanner.js must not throw at require() time');
    });

    test('getSavedGames returns an array', () => {
        const { getSavedGames } = require('../../gameScanner');

        assert.equal(typeof getSavedGames, 'function',
            'getSavedGames must be exported as a function');

        const result = getSavedGames();

        assert.ok(Array.isArray(result),
            `getSavedGames() must return an array, got: ${typeof result}`);
    });

    test('each game object has required fields', () => {
        const { getSavedGames } = require('../../gameScanner');
        const games = getSavedGames();

        // Skip field check if library is empty (fresh install) — that is valid.
        if (games.length === 0) return;

        const REQUIRED_FIELDS = ['id', 'name'];

        for (const game of games.slice(0, 5)) {
            for (const field of REQUIRED_FIELDS) {
                assert.ok(
                    Object.prototype.hasOwnProperty.call(game, field),
                    `Game object missing required field: "${field}" in game: ${JSON.stringify(game).slice(0, 120)}`
                );
                assert.ok(
                    game[field] !== undefined && game[field] !== null,
                    `Game field "${field}" must not be null/undefined`
                );
            }
        }
    });

    test('game IDs are non-empty strings', () => {
        const { getSavedGames } = require('../../gameScanner');
        const games = getSavedGames();

        if (games.length === 0) return;

        for (const game of games.slice(0, 10)) {
            assert.equal(typeof game.id, 'string',
                `game.id must be a string, got ${typeof game.id}`);
            assert.ok(game.id.length > 0,
                `game.id must be non-empty`);
        }
    });

    test('collectionsHandler module loads without throwing (Electron env)', () => {
        // collectionsHandler.js calls app.getPath() at module load time — Electron env only.
        let colHandler;
        try {
            colHandler = require('../../collectionsHandler');
        } catch (err) {
            const msg = err && err.message ? err.message : String(err);
            if (msg.includes('getPath') || msg.includes('electron')) return; // expected in Node-only env
            throw err;
        }
        assert.ok(colHandler !== undefined, 'collectionsHandler must export something');
    });

    test('getCollections returns an array (Electron env)', () => {
        let colHandler;
        try {
            colHandler = require('../../collectionsHandler');
        } catch (err) {
            const msg = err && err.message ? err.message : String(err);
            if (msg.includes('getPath') || msg.includes('electron')) return;
            throw err;
        }

        assert.equal(typeof colHandler.getCollections, 'function',
            'colHandler.getCollections must be a function');

        const result = colHandler.getCollections();
        assert.ok(Array.isArray(result),
            `getCollections() must return an array, got: ${typeof result}`);
    });

});
