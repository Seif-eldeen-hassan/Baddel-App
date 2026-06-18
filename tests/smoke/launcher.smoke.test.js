'use strict';

/**
 * Smoke test: launcher path resolution IPC contract
 *
 * Validates that the launcher path resolver modules load without error and
 * that the platform info lookup returns the expected shape. The actual OS
 * file detection is NOT called (it requires registry access / real paths)
 * but the resolver module and its known-platform registry are verified.
 *
 * What this guards:
 *   - launcherPathResolver module loads without throwing
 *   - Known platforms (epic, ea, ubisoft, riot, rockstar) are registered
 *   - getPlatformInfo returns a non-null object with required fields
 *   - safeLauncher module loads without throwing
 *   - launchHandlers module loads without throwing
 *
 * MIGRATION GATE: If this test fails after any migration step, the launcher
 * infrastructure has been broken. Do not merge until fixed.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const KNOWN_PLATFORMS = ['epic', 'ea', 'ubisoft', 'riot', 'rockstar'];

describe('Launcher — smoke', () => {

    test('launcherPathResolver module loads without throwing', () => {
        assert.doesNotThrow(() => {
            require('../../services/launcherPathResolver');
        }, 'services/launcherPathResolver.js must not throw at require() time');
    });

    test('launcherPathResolver exports required functions', () => {
        const resolver = require('../../services/launcherPathResolver');
        const REQUIRED = ['getPlatformInfo', 'findLauncherExe'];

        for (const fn of REQUIRED) {
            assert.equal(
                typeof resolver[fn], 'function',
                `launcherPathResolver must export ${fn} as a function`
            );
        }
    });

    test('getPlatformInfo returns valid objects for known platforms', () => {
        const resolver = require('../../services/launcherPathResolver');

        for (const platform of KNOWN_PLATFORMS) {
            const info = resolver.getPlatformInfo(platform);
            assert.ok(
                info !== null && info !== undefined,
                `getPlatformInfo("${platform}") must not return null/undefined`
            );
            assert.equal(typeof info, 'object',
                `getPlatformInfo("${platform}") must return an object`);
            assert.ok(
                info.name || info.exeName || info.dialogTitle,
                `getPlatformInfo("${platform}") result must have at least one identifying field (name/exeName/dialogTitle)`
            );
        }
    });

    test('getPlatformInfo returns null for unknown platforms', () => {
        const resolver = require('../../services/launcherPathResolver');
        const result = resolver.getPlatformInfo('__nonexistent_platform_xyz__');
        assert.ok(
            result === null || result === undefined,
            `getPlatformInfo for unknown platform must return null/undefined, got: ${JSON.stringify(result)}`
        );
    });

    test('riotPathResolver module loads without throwing', () => {
        assert.doesNotThrow(() => {
            require('../../services/riotPathResolver');
        }, 'services/riotPathResolver.js must not throw at require() time');
    });

    test('riotPathResolver exports findRiotClientExe function', () => {
        const resolver = require('../../services/riotPathResolver');
        assert.equal(
            typeof resolver.findRiotClientExe, 'function',
            'riotPathResolver must export findRiotClientExe as a function'
        );
    });

    test('safeLauncher module loads without throwing', () => {
        assert.doesNotThrow(() => {
            require('../../services/safeLauncher');
        }, 'services/safeLauncher.js must not throw at require() time');
    });

    test('safeLauncher exports openProtocolUrl function', () => {
        const launcher = require('../../services/safeLauncher');
        assert.equal(
            typeof launcher.openProtocolUrl, 'function',
            'safeLauncher must export openProtocolUrl as a function'
        );
    });

    test('ipcValidation module loads without throwing', () => {
        assert.doesNotThrow(() => {
            require('../../services/ipcValidation');
        }, 'services/ipcValidation.js must not throw at require() time');
    });

    test('ipcValidation exports core assertion functions', () => {
        const validation = require('../../services/ipcValidation');
        const REQUIRED = ['assertSafeId', 'assertString', 'sanitizeErrorForRenderer'];

        for (const fn of REQUIRED) {
            assert.equal(
                typeof validation[fn], 'function',
                `ipcValidation must export ${fn} as a function`
            );
        }
    });

    test('launchHandlers register function is exported', () => {
        const handler = require('../../handlers/launchHandlers');
        assert.equal(
            typeof handler.register, 'function',
            'handlers/launchHandlers.js must export a register function'
        );
    });

});
