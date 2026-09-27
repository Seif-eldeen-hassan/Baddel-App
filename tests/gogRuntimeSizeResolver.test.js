'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
    GogRuntimeSizeResolver,
    parseInfoJson,
    resolveOwnedProductId,
} = require('../src/features/downloads/infrastructure/providers/gog/GogRuntimeSizeResolver');

const OUTER_WORLDS_INFO = {
    size: {
        '*': { download_size: 0, disk_size: 0 },
        'en-US': { download_size: 55984240130, disk_size: 57202130251 },
    },
    dependencies: ['UE4REDIST'],
    buildId: '59923913140229466',
    versionName: '2.5.10.943539',
};

function outerWorldsPayload(overrides = {}) {
    return {
        platform: 'gog',
        installProvider: 'gogdl',
        gameId: 'gog_1986509485',
        title: 'The Outer Worlds: Spacer’s Choice Edition',
        accountId: '55050878658202451',
        ownedByAccountIds: ['55050878658202451'],
        gogIdentity: {
            galaxyExternalId: '1986509485',
            gamesDbExternalId: '1986509485',
            galaxyCertificatePresent: true,
            identitySource: 'gog-library-external-id',
        },
        ...overrides,
    };
}

test('real synced GOG identity resolves from gogIdentity instead of empty top-level provider fields', () => {
    assert.deepEqual(resolveOwnedProductId(outerWorldsPayload()), {
        productId: '1986509485',
        sizeReason: null,
    });
    assert.equal(resolveOwnedProductId(outerWorldsPayload({ accountId: 'different' })).sizeReason, 'GOG_GAME_NOT_OWNED');
});

test('gogdl info parser ignores log lines and reads the final JSON object', () => {
    const parsed = parseInfoJson(`[GENERIC DOWNLOAD_MANAGER] INFO: Depot version: 2\n${JSON.stringify(OUTER_WORLDS_INFO)}\n`);
    assert.equal(parsed.buildId, '59923913140229466');
});

test('runtime resolver returns the real independent Outer Worlds sizes without downloading', async () => {
    const calls = [];
    const runtime = {
        async run(args, options) {
            calls.push({ args, options });
            return { stdout: `runtime log\n${JSON.stringify(OUTER_WORLDS_INFO)}\n`, stderr: '', code: 0 };
        },
    };
    const resolver = new GogRuntimeSizeResolver({
        runtime,
        userDataDir: path.join('C:', 'Users', 'test', 'Baddel'),
        fsSync: { existsSync: () => true },
    });
    const result = await resolver.resolve(outerWorldsPayload());
    assert.equal(result.downloadSizeBytes, 55984240130);
    assert.equal(result.installedDiskSizeBytes, 57202130251);
    assert.equal(result.sizeSource, 'gogdl-info');
    assert.equal(result.sizeReason, null);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args.slice(-7), ['info', '1986509485', '--platform', 'windows', '--lang', 'en-US', '--skip-dlcs']);
    assert.equal(calls[0].options.redactOutput, true);
});

test('runtime resolver preserves typed auth and language failures', async () => {
    const runtime = { run: async () => { throw new Error('must not run'); } };
    const noAuth = new GogRuntimeSizeResolver({ runtime, userDataDir: 'C:\\data', fsSync: { existsSync: () => false } });
    assert.equal((await noAuth.resolve(outerWorldsPayload())).sizeReason, 'GOG_AUTH_REQUIRED');

    const missingLanguage = new GogRuntimeSizeResolver({
        runtime: { run: async () => ({ stdout: JSON.stringify({ size: { fr: { download_size: 1, disk_size: 2 } } }), stderr: '' }) },
        userDataDir: 'C:\\data',
        fsSync: { existsSync: () => true },
    });
    assert.equal((await missingLanguage.resolve(outerWorldsPayload())).sizeReason, 'GOG_LANGUAGE_SIZE_UNAVAILABLE');
});
