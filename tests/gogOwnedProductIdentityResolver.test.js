'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
    GogOwnedProductIdentityResolver,
    normalizeInputIdentity,
    findAuthValue,
} = require('../src/features/downloads/infrastructure/providers/gog/GogOwnedProductIdentityResolver');
const { GogIdentityMapRepository } = require('../src/features/downloads/infrastructure/providers/gog/GogIdentityMapRepository');
const { DownloadQueueManager } = require('../src/features/downloads/infrastructure/services/DownloadQueueManager');
const { DownloadPreflightService } = require('../src/features/downloads/infrastructure/services/DownloadPreflightService');
const { JsonDownloadRepository } = require('../src/features/downloads/infrastructure/repositories/JsonDownloadRepository');

function tempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-gog-identity-'));
}

function writeNestedAuth(userDataDir, accountId = 'acct-1') {
    const dir = path.join(userDataDir, 'gog', 'accounts', accountId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'auth.json'), JSON.stringify({
        '46899977096215655': {
            access_token: 'access-token-test',
            refresh_token: 'refresh-token-test',
            expires_at: 9999999999,
        },
    }), 'utf8');
}

function response(status, body) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
    };
}

function makeFetch(routes = {}) {
    const calls = [];
    const fetchImpl = async (url, options = {}) => {
        const raw = String(url);
        calls.push({ url: raw, headers: options.headers || {} });
        for (const [pattern, handler] of routes.entries()) {
            if (pattern.test(raw)) return handler(raw, options);
        }
        return response(404, { error: 'not_found' });
    };
    fetchImpl.calls = calls;
    return fetchImpl;
}

function basePayload(overrides = {}) {
    return {
        gameId: 'gog_56258463881831590',
        title: '9 Years of Shadows',
        platform: 'gog',
        accountId: 'acct-1',
        installPath: path.join(process.cwd(), '.tmp-gog', '9 Years'),
        providerProductId: '56258463881831590',
        providerAppName: '56258463881831590',
        gogIdentity: {
            galaxyLibraryEntryId: 'library-internal-1',
            galaxyExternalId: '56258463881831590',
            galaxyCertificatePresent: true,
            gamesDbReleaseId: '56258463881831590',
            gamesDbExternalId: '56258463881831590',
            storeSlug: '9_years_of_shadows',
        },
        ...overrides,
    };
}

test('GOG auth parser reads actual nested gogdl auth structure without exposing secrets', () => {
    const auth = {
        '46899977096215655': {
            access_token: 'nested-access',
            refresh_token: 'nested-refresh',
        },
    };
    assert.equal(findAuthValue(auth, ['access_token']), 'nested-access');
    assert.equal(findAuthValue(auth, ['refresh_token']), 'nested-refresh');
});

test('GOG identity normalization keeps internal GamesDB id separate from owned external id', () => {
    const identity = normalizeInputIdentity({
        gameId: 'gog_56258463881831590',
        gogIdentity: {
            galaxyLibraryEntryId: 'lib-row-1',
            galaxyExternalId: '111',
            gamesDbReleaseId: '56258463881831590',
            gamesDbGameId: 'game-db-game',
            gamesDbExternalId: '222',
            releasePerPlatformId: 'rpp-1',
        },
    });
    assert.equal(identity.galaxyExternalId, '111');
    assert.equal(identity.gamesDbReleaseId, '56258463881831590');
    assert.equal(identity.gamesDbExternalId, '222');
});

test('GOG resolver rejects 562 zero-build identity and catalog 209 invalid licence without caching', async () => {
    const dir = tempDir();
    try {
        writeNestedAuth(dir);
        const fetchImpl = makeFetch(new Map([
            [/products\/56258463881831590\/os\/windows\/builds.*generation=2/, () => response(200, { items: [] })],
            [/products\/56258463881831590\/os\/windows\/builds.*generation=1/, () => response(200, { items: [] })],
            [/catalog\.gog\.com/, () => response(200, { products: [{ id: '2099051765', title: '9 Years of Shadows', slug: '9_years_of_shadows' }] })],
            [/products\/2099051765\/os\/windows\/builds.*generation=2/, () => response(200, { items: [{ build_id: '58654342451764486', product_id: '2099051765' }, { build_id: '2', product_id: '2099051765' }] })],
            [/products\/2099051765\/secure_link/, () => response(403, { error: 'invalid_licence' })],
        ]));
        const resolver = new GogOwnedProductIdentityResolver({ userDataDir: dir, fetchImpl });
        await assert.rejects(
            () => resolver.resolveForQueue(basePayload()),
            err => err.code === 'GOG_INVALID_LICENCE'
        );
        const cachePath = path.join(dir, 'platform-sync', 'gog_product_identity_map.json');
        const cache = fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, 'utf8')) : { mappings: {} };
        assert.deepEqual(cache.mappings, {});
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('GOG resolver accepts an owned verified candidate and persists a safe mapping', async () => {
    const dir = tempDir();
    try {
        writeNestedAuth(dir);
        const fetchImpl = makeFetch(new Map([
            [/products\/333\/os\/windows\/builds.*generation=2/, () => response(200, { items: [{ build_id: 'build-333', product_id: '333' }] })],
            [/products\/333\/secure_link/, () => response(200, { urls: [{ url: 'https://cdn.gog.example/game?token=secret' }] })],
            [/catalog\.gog\.com/, () => response(200, { products: [] })],
        ]));
        const resolver = new GogOwnedProductIdentityResolver({ userDataDir: dir, fetchImpl, now: () => '2026-07-20T00:00:00.000Z' });
        const resolved = await resolver.resolveForQueue(basePayload({
            providerProductId: null,
            providerAppName: null,
            gogIdentity: {
                galaxyLibraryEntryId: 'lib-333',
                galaxyExternalId: '333',
                galaxyCertificatePresent: true,
                gamesDbReleaseId: '56258463881831590',
            },
        }));
        assert.equal(resolved.gogdlAppName, '333');
        assert.equal(resolved.contentSystemProductId, '333');
        assert.equal(resolved.ownershipVerified, true);
        assert.equal(resolved.secureLinkVerified, true);
        assert.equal(resolved.verifiedBuildId, 'build-333');
        const raw = fs.readFileSync(path.join(dir, 'platform-sync', 'gog_product_identity_map.json'), 'utf8');
        assert.equal(raw.includes('access-token-test'), false);
        assert.equal(raw.includes('refresh-token-test'), false);
        assert.equal(raw.includes('https://cdn.gog.example'), false);
        const parsed = JSON.parse(raw);
        const mapping = Object.values(parsed.mappings)[0];
        assert.equal(mapping.gogdlAppName, '333');
        assert.equal(mapping.ownershipVerified, true);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('GOG resolver retries a transient transport failure without changing identity', async () => {
    const dir = tempDir();
    try {
        writeNestedAuth(dir);
        let buildAttempts = 0;
        const fetchImpl = makeFetch(new Map([
            [/catalog\.gog\.com/, () => response(200, { products: [] })],
            [/products\/333\/os\/windows\/builds.*generation=2/, () => {
                buildAttempts += 1;
                if (buildAttempts === 1) throw Object.assign(new Error('socket reset'), { code: 'ECONNRESET' });
                return response(200, { items: [{ build_id: 'build-333', product_id: '333' }] });
            }],
            [/products\/333\/secure_link/, () => response(200, { urls: [] })],
        ]));
        const resolver = new GogOwnedProductIdentityResolver({
            userDataDir: dir,
            fetchImpl,
            sleep: async () => {},
        });
        const resolved = await resolver.resolveForQueue(basePayload({
            providerProductId: null,
            providerAppName: null,
            gogIdentity: { galaxyExternalId: '333', gamesDbExternalId: '333' },
        }));
        assert.equal(buildAttempts, 2);
        assert.equal(resolved.gogdlAppName, '333');
        assert.equal(resolved.ownershipVerified, true);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('GOG resolver reports exhausted transport failure instead of account verification failure', async () => {
    const dir = tempDir();
    try {
        writeNestedAuth(dir);
        const fetchImpl = async () => { throw new TypeError('fetch failed', { cause: Object.assign(new Error('connect timeout'), { code: 'UND_ERR_CONNECT_TIMEOUT' }) }); };
        const resolver = new GogOwnedProductIdentityResolver({
            userDataDir: dir,
            fetchImpl,
            maxNetworkRetries: 1,
            sleep: async () => {},
        });
        await assert.rejects(
            () => resolver.resolveForQueue(basePayload()),
            err => err.code === 'GOG_NETWORK_ERROR' && /temporarily unavailable/i.test(err.message)
        );
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('GOG resolver refreshes expired gogdl auth once before rejecting an owned candidate', async () => {
    const dir = tempDir();
    try {
        writeNestedAuth(dir);
        let refreshCalls = 0;
        const runtime = {
            run: async (args) => {
                refreshCalls += 1;
                assert.deepEqual(args, ['--auth-config-path', path.join(dir, 'gog', 'accounts', 'acct-1', 'auth.json'), 'auth']);
                const authPath = path.join(dir, 'gog', 'accounts', 'acct-1', 'auth.json');
                fs.writeFileSync(authPath, JSON.stringify({
                    '46899977096215655': {
                        access_token: 'refreshed-access-token',
                        refresh_token: 'refreshed-refresh-token',
                    },
                }), 'utf8');
                return { code: 0, stdout: '', stderr: '' };
            },
        };
        const fetchImpl = makeFetch(new Map([
            [/products\/333\/os\/windows\/builds.*generation=2/, (_url, options) => {
                return options.headers.Authorization === 'Bearer refreshed-access-token'
                    ? response(200, { items: [{ build_id: 'build-333', product_id: '333' }] })
                    : response(401, { error: 'expired_token' });
            }],
            [/products\/333\/secure_link/, (_url, options) => {
                return options.headers.Authorization === 'Bearer refreshed-access-token'
                    ? response(200, { urls: [{ url: 'https://cdn.gog.example/game?token=secret' }] })
                    : response(401, { error: 'expired_token' });
            }],
            [/catalog\.gog\.com/, () => response(200, { products: [] })],
        ]));
        const resolver = new GogOwnedProductIdentityResolver({ userDataDir: dir, fetchImpl, runtime });
        const resolved = await resolver.resolveForQueue(basePayload({
            providerProductId: null,
            providerAppName: null,
            gogIdentity: {
                galaxyExternalId: '333',
                gamesDbReleaseId: '56258463881831590',
            },
        }));
        assert.equal(refreshCalls, 1);
        assert.equal(resolved.gogdlAppName, '333');
        assert.equal(resolved.ownershipVerified, true);
        assert.equal(resolved.secureLinkVerified, true);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('GOG queue resolves identity before creating a task and passes verified fields only', async () => {
    const dir = tempDir();
    try {
        writeNestedAuth(dir);
        const fetchImpl = makeFetch(new Map([
            [/products\/333\/os\/windows\/builds.*generation=2/, () => response(200, { items: [{ build_id: 'build-333', product_id: '333' }] })],
            [/products\/333\/secure_link/, () => response(200, { urls: [{ url: 'https://cdn.gog.example/game?token=secret' }] })],
            [/catalog\.gog\.com/, () => response(200, { products: [] })],
        ]));
        const resolver = new GogOwnedProductIdentityResolver({ userDataDir: dir, fetchImpl });
        const manager = new DownloadQueueManager({
            repository: new JsonDownloadRepository({ userDataDir: dir }),
            preflight: new DownloadPreflightService(),
            providerExecutor: { start: async () => ({ statusMessage: 'done' }) },
            identityResolvers: { gog: resolver },
        });
        await manager.load();
        const result = await manager.queueInstall(basePayload({
            gogIdentity: { galaxyExternalId: '333', gamesDbReleaseId: '56258463881831590' },
            installPath: path.join(dir, 'Games', 'Nine Years'),
        }));
        assert.equal(result.task.gogdlAppName, '333');
        assert.equal(result.task.providerProductId, '333');
        assert.equal(result.task.ownershipVerified, true);
        assert.equal(result.task.identityKey.includes('56258463881831590'), false);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('GOG resolver returns ambiguity when multiple licensed candidates validate', async () => {
    const dir = tempDir();
    try {
        writeNestedAuth(dir);
        const fetchImpl = makeFetch(new Map([
            [/catalog\.gog\.com/, () => response(200, { products: [
                { id: '444', title: 'Same Game', slug: 'same_game' },
                { id: '555', title: 'Same Game', slug: 'same_game_alt' },
            ] })],
            [/products\/444\/os\/windows\/builds.*generation=2/, () => response(200, { items: [{ build_id: 'b444', product_id: '444' }] })],
            [/products\/555\/os\/windows\/builds.*generation=2/, () => response(200, { items: [{ build_id: 'b555', product_id: '555' }] })],
            [/products\/444\/secure_link/, () => response(200, { urls: [] })],
            [/products\/555\/secure_link/, () => response(200, { urls: [] })],
        ]));
        const resolver = new GogOwnedProductIdentityResolver({ userDataDir: dir, fetchImpl });
        await assert.rejects(
            () => resolver.resolveForQueue(basePayload({
                title: 'Same Game',
                providerProductId: null,
                providerAppName: null,
                gogIdentity: { releasePerPlatformId: 'same-game-key' },
            })),
            err => err.code === 'GOG_OWNED_IDENTITY_AMBIGUOUS'
        );
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('GOG resolver reuses verified cache only after revalidating build and secure link', async () => {
    const dir = tempDir();
    try {
        writeNestedAuth(dir);
        const repo = new GogIdentityMapRepository({ userDataDir: dir });
        await repo.set('acct-1:333', {
            accountId: 'acct-1',
            galaxyExternalId: '333',
            contentSystemProductId: '333',
            gogdlAppName: '333',
            title: 'Cached Game',
            source: 'verified-cache',
            ownershipVerified: true,
            secureLinkVerified: true,
            verifiedBuildCount: 1,
            resolvedAt: '2026-07-20T00:00:00.000Z',
        });
        const fetchImpl = makeFetch(new Map([
            [/products\/333\/os\/windows\/builds.*generation=2/, () => response(200, { items: [{ build_id: 'b333', product_id: '333' }] })],
            [/products\/333\/secure_link/, () => response(200, { urls: [] })],
        ]));
        const resolver = new GogOwnedProductIdentityResolver({ userDataDir: dir, fetchImpl, mapRepository: repo });
        const resolved = await resolver.resolveForQueue(basePayload({
            title: 'Cached Game',
            providerProductId: null,
            providerAppName: null,
            gogIdentity: { galaxyExternalId: '333' },
        }));
        assert.equal(resolved.gogdlAppName, '333');
        assert.equal(fetchImpl.calls.some(call => call.url.includes('/secure_link')), true);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('GOG maintenance revalidates only a persisted exact verified identity', async () => {
    const dir = tempDir();
    try {
        writeNestedAuth(dir);
        const fetchImpl = makeFetch(new Map([
            [/products\/333\/os\/windows\/builds.*generation=2/, () => response(200, { items: [{ build_id: 'current-build', product_id: '333' }] })],
            [/products\/333\/secure_link/, () => response(200, { urls: [] })],
        ]));
        const resolver = new GogOwnedProductIdentityResolver({ userDataDir: dir, fetchImpl });
        const resolved = await resolver.revalidateVerifiedTask(basePayload({
            gogProductId: '333', contentSystemProductId: '333', gogdlAppName: '333',
            ownershipVerified: true, secureLinkVerified: true,
        }));
        assert.equal(resolved.verifiedBuildId, 'current-build');
        assert.equal(resolved.identitySource, 'persisted-verified-install');
        await assert.rejects(() => resolver.revalidateVerifiedTask(basePayload({
            gogProductId: '333', contentSystemProductId: '333', gogdlAppName: '444',
            ownershipVerified: true, secureLinkVerified: true,
        })), error => error.code === 'GOG_OWNED_IDENTITY_UNRESOLVED');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
