'use strict';

/**
 * ESLint flat config — Baddel Launcher
 * Compatible with ESLint v9+.
 *
 * Boundary rules enforce Clean Architecture layer isolation in src/features/.
 * Violations are lint ERRORS — they block CI and must be fixed before merge.
 *
 * During migration (Phases 1–7) the legacy root-level files (main.js,
 * gameScanner.js, etc.) are in the "legacy" element type and are allowed
 * to import anything. Remove entries from the legacy pattern list as each
 * file is migrated into src/features/.
 */

const boundariesPlugin = require('eslint-plugin-boundaries');

/** @type {import('eslint').Linter.FlatConfig[]} */
module.exports = [
    // ── Global ignores ────────────────────────────────────────────────────────
    {
        ignores: [
            'node_modules/**',
            'dist/**',
            'build-tmp/**',
            'python_env/**',
            'baddel-steam-integration/**',
            'steam-runtime/**',
            'scripts/**',
            '**/*.test.js',
            '**/.gitkeep',
        ],
    },

    // ── src/features/ — boundary-enforced Clean Architecture layers ───────────
    {
        files: ['src/features/**/*.js', 'src/shared/**/*.js', 'src/main/**/*.js'],
        plugins: {
            boundaries: boundariesPlugin,
        },
        settings: {
            'boundaries/elements': [
                // ── New architecture ──────────────────────────────────────────
                {
                    type: 'domain',
                    pattern: 'src/features/*/domain/**',
                },
                {
                    type: 'application',
                    pattern: 'src/features/*/application/**',
                },
                {
                    type: 'infrastructure',
                    pattern: 'src/features/*/infrastructure/**',
                },
                {
                    type: 'presentation',
                    pattern: 'src/features/*/presentation/**',
                },
                {
                    type: 'shared',
                    pattern: 'src/shared/**',
                },
                {
                    type: 'main',
                    pattern: 'src/main/**',
                },
            ],
        },
        rules: {
            // ── Architecture boundary enforcement ─────────────────────────────
            //
            //   domain       → imports nothing outside itself
            //   application  → imports domain only
            //   infrastructure → imports application + domain + shared
            //   presentation → imports shared only (never imports use cases directly)
            //   shared       → imports nothing outside itself
            //   main         → imports infrastructure adapters + shared only
            //
            'boundaries/element-types': ['error', {
                default: 'disallow',
                rules: [
                    { from: 'domain',         allow: [] },
                    { from: 'application',    allow: ['domain'] },
                    { from: 'infrastructure', allow: ['application', 'domain', 'shared'] },
                    { from: 'presentation',   allow: ['shared'] },
                    { from: 'shared',         allow: [] },
                    { from: 'main',           allow: ['infrastructure', 'shared'] },
                ],
            }],
        },
    },

    // ── src/js/ renderer files — browser environment ──────────────────────────
    {
        files: ['src/js/**/*.js', 'src/renderer/**/*.js'],
        languageOptions: {
            globals: {
                window: 'readonly',
                document: 'readonly',
                console: 'readonly',
                electronAPI: 'readonly',
            },
        },
    },
];
