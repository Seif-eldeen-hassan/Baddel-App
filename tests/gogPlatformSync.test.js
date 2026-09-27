'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const crypto = require('node:crypto');

const { createSyncConnectors, CONNECTOR_METHODS } = require('../src/features/sync/infrastructure/composition/createSyncConnectors');
const { PlatformSyncCacheRepository } = require('../src/features/sync/infrastructure/repositories/PlatformSyncCacheRepository');
const { GogRuntime, redactGogSecrets } = require('../src/features/sync/infrastructure/integrations/gog/GogRuntime');
const { GogAuthService, readCredentials, readCredentialsFromRuntimeResult, mergeProfileCredentials } = require('../src/features/sync/infrastructure/integrations/gog/GogAuthService');
const { GogApiClient } = require('../src/features/sync/infrastructure/integrations/gog/GogApiClient');
const { normalizeGogRelease, mergeGogGames } = require('../src/features/sync/infrastructure/integrations/gog/GogLibraryNormalizer');

function connector(name) {
    return Object.fromEntries(CONNECTOR_METHODS.map((method) => [method, function namedConnectorMethod() { return name; }]));
}

function tempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-gog-sync-'));
}

test('createSyncConnectors requires and exposes GOG without changing Steam/Epic identity', () => {
    const steam = connector('steam');
    const epic = connector('epic');
    const gog = connector('gog');
    const created = createSyncConnectors({ steam, epic, gog });

    assert.deepEqual(Object.keys(created.gogConnector), CONNECTOR_METHODS);
    assert.equal(created.steamConnector.isLinked, steam.isLinked);
    assert.equal(created.epicConnector.isLinked, epic.isLinked);
    assert.equal(created.gogConnector.isLinked, gog.isLinked);
    assert.deepEqual(Object.keys(created.ALL_CONNECTORS), ['epic', 'steam', 'gog']);
    assert.throws(() => createSyncConnectors({ steam, epic }), /gog connector/);
});

test('PlatformSyncCacheRepository routes GOG explicitly and rejects unsupported platforms', async () => {
    const userData = tempDir();
    try {
        const repo = new PlatformSyncCacheRepository({ userDataDir: userData });
        const gogLibrary = [{ id: 'gog_123', productId: '123' }];
        assert.equal(repo.gogAccountsFile, path.join(userData, 'platform-sync', 'gog_accounts.json'));
        assert.equal(repo.gogMergedCacheFile, path.join(userData, 'platform-sync', 'gog_library_merged.json'));
        assert.equal(repo.getMergedCacheFile('gog'), repo.gogMergedCacheFile);

        await repo.writeGogAccountsAtomic([{ id: 'acct' }]);
        assert.deepEqual(repo.readGogAccountsSync(), [{ id: 'acct' }]);
        assert.equal(repo.isGogLinked(), true);

        await repo.writeMergedLibrary('gog', gogLibrary);
        assert.deepEqual(await repo.readMergedLibrary('gog'), gogLibrary);
        assert.throws(() => repo.getMergedCacheFile('origin'), /Unsupported platform cache/);
        await assert.rejects(() => repo.readMergedLibrary('origin'), /Unsupported platform library/);
    } finally {
        fs.rmSync(userData, { recursive: true, force: true });
    }
});

test('GogRuntime resolves dev and packaged paths and redacts secrets', async () => {
    const root = tempDir();
    const resources = tempDir();
    try {
        fs.mkdirSync(path.join(root, 'gog-runtime'), { recursive: true });
        fs.writeFileSync(path.join(root, 'gog-runtime', 'gogdl.exe'), 'runtime');
        fs.writeFileSync(path.join(root, 'gog-runtime', 'version.json'), JSON.stringify({ sha256: crypto.createHash('sha256').update('runtime').digest('hex') }));
        const runtime = new GogRuntime({
            projectRoot: root,
            resourcesPath: resources,
            execFile: (_exe, _args) => {
                const listeners = {};
                return {
                    stdout: { on(_event, cb) { cb('1.2.2'); } },
                    stderr: { on() {} },
                    on(event, cb) {
                        listeners[event] = cb;
                        if (event === 'close') setImmediate(() => cb(0));
                    },
                };
            },
        });
        assert.equal(runtime.exePath, path.join(root, 'gog-runtime', 'gogdl.exe'));
        assert.equal((await runtime.verify()).version, '1.2.2');
        assert.match(redactGogSecrets('access_token: abc refresh_token=def code xyz'), /\[REDACTED\]/);

        const packaged = new GogRuntime({ projectRoot: root, resourcesPath: resources, isPackaged: true });
        assert.equal(packaged.exePath, path.join(resources, 'gog-runtime', 'gogdl.exe'));
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(resources, { recursive: true, force: true });
    }
});

test('packaged GogRuntime never uses app.asar as the child-process working directory', async () => {
    const resources = tempDir();
    const calls = [];
    try {
        const runtimeDir = path.join(resources, 'gog-runtime');
        fs.mkdirSync(runtimeDir, { recursive: true });
        fs.writeFileSync(path.join(runtimeDir, 'gogdl.exe'), 'runtime');
        const processStub = () => {
            const stream = { on() {} };
            const proc = {
                pid: 123,
                stdout: stream,
                stderr: stream,
                on(event, callback) {
                    if (event === 'close') setImmediate(() => callback(0, null));
                    return proc;
                },
                once(event, callback) { return proc.on(event, callback); },
            };
            return proc;
        };
        const runtime = new GogRuntime({
            projectRoot: path.join(resources, 'app.asar'),
            resourcesPath: resources,
            isPackaged: true,
            fs: { accessSync() {}, existsSync: fs.existsSync },
            execFile: (exe, args, options) => { calls.push({ kind: 'execFile', exe, args, options }); return processStub(); },
            spawn: (exe, args, options) => { calls.push({ kind: 'spawn', exe, args, options }); return processStub(); },
            versionInfo: { sha256: 'unused' },
        });

        await runtime.run(['--version']);
        await runtime.spawnCommand(['list']);

        assert.equal(runtime.defaultWorkingDirectory, runtimeDir);
        assert.deepEqual(calls.map(call => call.options.cwd), [runtimeDir, runtimeDir]);
        assert.equal(calls.some(call => call.options.cwd.endsWith('app.asar')), false);
    } finally {
        fs.rmSync(resources, { recursive: true, force: true });
    }
});
test('GogApiClient reads paginated releases and refreshes once on 401', async () => {
    const urls = [];
    let token = 'old';
    const fetchImpl = async (url, options) => {
        urls.push(String(url));
        if (options.headers.Authorization === 'Bearer old') {
            return { ok: false, status: 401, json: async () => ({}) };
        }
        const parsed = new URL(String(url));
        if (!parsed.searchParams.get('page_token')) {
            return { ok: true, status: 200, json: async () => ({ releases: [{ product_id: '1', title: 'One' }], next_page_token: 'n2' }) };
        }
        return { ok: true, status: 200, json: async () => ({ releases: [{ product_id: '2', title: 'Two' }] }) };
    };
    const client = new GogApiClient({ fetchImpl, sleep: async () => {}, timeoutMs: 500 });
    const releases = await client.fetchLibraryReleases({
        userId: 'u1',
        accessToken: token,
        refreshAuth: async () => {
            token = 'new';
            return { accessToken: token };
        },
    });
    assert.deepEqual(releases.map((r) => r.product_id), ['1', '2']);
    assert.equal(urls.length, 3);
    assert.match(urls[2], /page_token=n2/);
});

test('GOG auth parser accepts gogdl token files without a direct user id', () => {
    const credentials = readCredentials({
        authorization: {
            access_token: 'access-a',
            refresh_token: 'refresh-b',
        },
    }, { allowMissingUserId: true });

    assert.equal(credentials.userId, null);
    assert.equal(credentials.accessToken, 'access-a');
    assert.equal(credentials.refreshToken, 'refresh-b');

    const merged = mergeProfileCredentials(credentials, {
        userId: 987654,
        username: 'PlayerOne',
    });
    assert.equal(merged.userId, '987654');
    assert.equal(merged.displayName, 'PlayerOne');
});

test('GOG auth parser prefers gogdl stdout credentials with user id', () => {
    const credentials = readCredentialsFromRuntimeResult({
        stdout: JSON.stringify({
            access_token: 'access-a',
            refresh_token: 'refresh-b',
            user_id: 'user-123',
        }),
    }, null);

    assert.equal(credentials.userId, 'user-123');
    assert.equal(credentials.accessToken, 'access-a');
});

test('GogApiClient fetches user details with bearer auth', async () => {
    const calls = [];
    const client = new GogApiClient({
        sleep: async () => {},
        fetchImpl: async (url, options) => {
            calls.push({ url: String(url), auth: options.headers.Authorization });
            return { ok: true, status: 200, json: async () => ({ userId: 123, username: 'GOGUser' }) };
        },
    });
    const profile = await client.fetchUserDetails({ userId: 'user-123', accessToken: 'token-a' });
    assert.equal(profile.userId, 123);
    assert.equal(calls[0].url, 'https://users.gog.com/users/user-123');
    assert.equal(calls[0].auth, 'Bearer token-a');
});

test('GogApiClient fetches GamesDB details with library certificate', async () => {
    const calls = [];
    const client = new GogApiClient({
        sleep: async () => {},
        fetchImpl: async (url, options) => {
            calls.push({ url: String(url), headers: options.headers });
            return { ok: true, status: 200, json: async () => ({ external_id: '42', title: { '*': 'Game 42' } }) };
        },
    });
    const details = await client.fetchGamesDbData({
        externalId: '42',
        certificate: 'cert-a',
        accessToken: 'token-a',
    });
    assert.equal(details.title['*'], 'Game 42');
    assert.equal(calls[0].url, 'https://gamesdb.gog.com/platforms/gog/external_releases/42');
    assert.equal(calls[0].headers.Authorization, 'Bearer token-a');
    assert.equal(calls[0].headers['X-GOG-Library-Cert'], 'cert-a');
});

test('GogApiClient fetches GOG Store product metadata for rich descriptions', async () => {
    const calls = [];
    const client = new GogApiClient({
        sleep: async () => {},
        fetchImpl: async (url, options) => {
            calls.push({ url: String(url), headers: options.headers });
            return { ok: true, status: 200, json: async () => ({ id: 42, description: { full: '<p>Real GOG description.</p>' } }) };
        },
    });
    const product = await client.fetchStoreProductData({ productId: '42', accessToken: 'token-a' });
    assert.equal(product.description.full, '<p>Real GOG description.</p>');
    assert.equal(calls[0].url, 'https://api.gog.com/products/42?expand=description%2Cscreenshots%2Cvideos%2Crequirements%2Cratings');
    assert.equal(calls[0].headers.Authorization, 'Bearer token-a');
});

test('GogApiClient fetches GOG Store page metadata as text fallback', async () => {
    const calls = [];
    const client = new GogApiClient({
        sleep: async () => {},
        fetchImpl: async (url) => {
            calls.push(String(url));
            return { ok: true, status: 200, text: async () => '<html>store page</html>' };
        },
    });
    const page = await client.fetchStorePageData({ url: 'https://www.gog.com/game/the_whisperer' });
    assert.equal(page.url, 'https://www.gog.com/game/the_whisperer');
    assert.equal(page.html, '<html>store page</html>');
    assert.equal(calls[0], 'https://www.gog.com/game/the_whisperer');
});

test('GogApiClient searches the GOG catalog when library ids are not store ids', async () => {
    const calls = [];
    const client = new GogApiClient({
        sleep: async () => {},
        fetchImpl: async (url) => {
            calls.push(String(url));
            return { ok: true, status: 200, json: async () => ({ products: [{ id: '1426240474', slug: 'the_whisperer', title: 'The Whisperer' }] }) };
        },
    });
    const catalog = await client.searchStoreCatalog({ query: 'The Whisperer' });
    assert.equal(catalog.products[0].slug, 'the_whisperer');
    assert.equal(calls[0], 'https://catalog.gog.com/v1/catalog?limit=20&query=The+Whisperer');
});

test('GogAuthService link completes account id from profile when gogdl auth file omits it', async () => {
    const userData = tempDir();
    try {
        const service = new GogAuthService({
            userDataDir: userData,
            runtime: {
                verify: async () => ({ version: '1.2.2' }),
                run: async (args) => {
                    const authPath = args[args.indexOf('--auth-config-path') + 1];
                    fs.mkdirSync(path.dirname(authPath), { recursive: true });
                    fs.writeFileSync(authPath, JSON.stringify({
                        tokens: {
                            access_token: 'access-a',
                            refresh_token: 'refresh-b',
                        },
                    }));
                },
            },
            profileResolver: async () => ({ userId: 'gog-user-1', username: 'GOG Player' }),
        });
        service._openLoginWindow = async () => 'login-code';

        const credentials = await service.link(null, () => {});
        assert.equal(credentials.userId, 'gog-user-1');
        assert.equal(credentials.displayName, 'GOG Player');
        assert.equal(fs.existsSync(path.join(userData, 'gog', 'accounts', 'gog-user-1', 'auth.json')), true);
    } finally {
        fs.rmSync(userData, { recursive: true, force: true });
    }
});

test('GOG normalizer uses gog product identity and merges multi-account ownership', () => {
    const accountA = { id: 'a1', displayName: 'A' };
    const accountB = { id: 'b1', displayName: 'B' };
    const gameA = normalizeGogRelease({
        product_id: 123,
        title: 'Cyber Game',
        images: { cover: 'https://img/cover.jpg', hero: 'https://img/hero.jpg', logo: 'https://img/logo.png' },
    }, accountA, { now: () => 'now' });
    const gameB = normalizeGogRelease({ product_id: 123, title: 'Cyber Game' }, accountB, { now: () => 'now' });
    const merged = new Map();
    mergeGogGames(merged, [gameA], accountA);
    mergeGogGames(merged, [gameB], accountB);
    const result = merged.get('gog_123');

    assert.equal(gameA.id, 'gog_123');
    assert.equal(gameA.allIds.gog, '123');
    assert.deepEqual(result.ownedByAccountIds, ['a1', 'b1']);
    assert.deepEqual(result.ownedBy, ['A', 'B']);
    assert.equal(result.coverUrl, 'https://img/cover.jpg');
});

test('GOG normalizer accepts Galaxy/GamesDB metadata entries', () => {
    const game = normalizeGogRelease({
        external_id: '1207666353',
        type: 'game',
        title: { '*': 'Baldur Gate' },
        game: {
            visible_in_library: true,
            title: { '*': 'Baldur Gate Enhanced Edition' },
            vertical_cover: { url_format: 'https://images.gog/{formatter}/cover.{ext}' },
            background: { url_format: 'https://images.gog/{formatter}/hero.{ext}' },
            logo: { url_format: 'https://images.gog/{formatter}/logo.{ext}' },
        },
    }, { id: 'acct-1', displayName: 'Real GOG' }, { now: () => 'now' });

    assert.equal(game.id, 'gog_1207666353');
    assert.equal(game.title, 'Baldur Gate');
    assert.equal(game.coverUrl, 'https://images.gog//cover.jpg');
    assert.equal(game.heroUrl, 'https://images.gog//hero.webp');
    assert.equal(game.logoUrl, null);
    assert.equal(game.info.description, 'Baldur Gate is synced from your GOG library. More details will appear when Baddel metadata is available.');
});

test('GOG normalizer rejects Amazon Prime entitlement duplicates', () => {
    const game = normalizeGogRelease({
        external_id: '52799553683128100',
        title: { '*': 'A Plague Tale: Innocence' },
        _libraryEntry: {
            title: 'A Plague Tale: Innocence - Amazon Prime',
        },
    }, { id: 'acct-1', displayName: 'Real GOG' }, { now: () => 'now' });

    assert.equal(game, null);
});

test('GOG normalizer carries GamesDB rich details into Game Details fields', () => {
    const game = normalizeGogRelease({
        external_id: '144',
        title: { '*': 'The Whisperer' },
        game: {
            description: { '*': 'A short narrative horror mystery set in Lower Canada.' },
            short_description: { '*': 'A narrative horror mystery.' },
            genres: [{ name: { '*': 'Adventure' } }, { name: 'Horror' }],
            screenshots: [{ url_format: 'https://images.gog/{formatter}/screen.{ext}' }],
            videos: [{ title: { '*': 'Launch Trailer' }, url: 'https://video.example/trailer' }],
        },
    }, { id: 'acct-1', displayName: 'Real GOG' }, { now: () => 'now' });

    assert.equal(game.description, 'A short narrative horror mystery set in Lower Canada.');
    assert.equal(game.short_description, 'A narrative horror mystery.');
    assert.deepEqual(game.info.genres, ['Adventure', 'Horror']);
    assert.deepEqual(game.info.screenshots, ['https://images.gog//screen.jpg']);
    assert.deepEqual(game.info.allTrailers, [{
        source: 'gog',
        title: 'Launch Trailer',
        name: 'Launch Trailer',
        url: 'https://video.example/trailer',
        thumbnail: null,
        thumbUrl: null,
    }]);
});

test('GOG normalizer prefers Store product description over generic fallback', () => {
    const game = normalizeGogRelease({
        external_id: '144',
        title: { '*': 'The Whisperer' },
        game: {
            vertical_cover: { url_format: 'https://images.gog/{formatter}/cover.{ext}' },
        },
        _storeProduct: {
            description: {
                lead: '<p>A point-and-click horror adventure.</p>',
                full: '<p>Follow a detective through a cold mystery in Lower Canada.</p>',
            },
            developers: [{ name: 'Studio Chien d’Or' }],
            publishers: ['Studio Chien d’Or'],
            release_date: '2021-12-16',
            genres: [{ name: 'Adventure' }],
            videos: [{ provider: 'youtube', provider_video_id: 'abc123', title: 'Trailer' }],
            requirements: {
                windows: {
                    minimum: '<strong>OS:</strong> Windows 7<br><strong>Processor:</strong> Dual Core',
                    recommended: {
                        os: 'Windows 10',
                        processor: 'Quad Core',
                        memory: '4 GB RAM',
                    },
                },
            },
        },
    }, { id: 'acct-1', displayName: 'Real GOG' }, { now: () => 'now' });

    assert.equal(game.short_description, 'A point-and-click horror adventure.');
    assert.equal(game.description, 'Follow a detective through a cold mystery in Lower Canada.');
    assert.equal(game.info.developer, 'Studio Chien d’Or');
    assert.equal(game.info.publisher, 'Studio Chien d’Or');
    assert.equal(game.info.releaseDate, '2021-12-16');
    assert.deepEqual(game.info.genres, ['Adventure']);
    assert.deepEqual(game.info.allTrailers, [{
        source: 'gog',
        title: 'Trailer',
        name: 'Trailer',
        url: 'https://www.youtube.com/watch?v=abc123',
        thumbnail: null,
        thumbUrl: null,
    }]);
    assert.deepEqual(game.info.requirements, {
        win: {
            minimum: 'OS: Windows 7\nProcessor: Dual Core',
            recommended: {
                os: 'Windows 10',
                cpu: 'Quad Core',
                ram: '4 GB RAM',
            },
        },
    });
    assert.doesNotMatch(game.description, /synced from your GOG library/);
});

test('GOG normalizer extracts store page rating and requirements fallback', () => {
    const game = normalizeGogRelease({
        external_id: '144',
        title: { '*': 'The Whisperer' },
        _storeProduct: {
            description: { full: '<p>Real page description.</p>' },
            slug: 'the_whisperer',
        },
        _storePage: {
            html: `
                <script type="application/ld+json">
                    {
                        "@type": "VideoGame",
                        "aggregateRating": {
                            "ratingValue": "4.2",
                            "bestRating": "5",
                            "ratingCount": "120"
                        },
                        "systemRequirements": {
                            "windows": {
                                "minimum": {
                                    "os": "Windows 7",
                                    "processor": "Dual Core",
                                    "memory": "4 GB RAM",
                                    "graphics": "DirectX 11 GPU"
                                }
                            }
                        }
                    }
                </script>
            `,
        },
    }, { id: 'acct-1', displayName: 'Real GOG' }, { now: () => 'now' });

    assert.deepEqual(game.info.ratings, [{
        source: 'gog',
        score: 4.2,
        max_score: 5,
        total_reviews: 120,
    }]);
    assert.deepEqual(game.info.requirements, {
        win: {
            minimum: {
                os: 'Windows 7',
                cpu: 'Dual Core',
                ram: '4 GB RAM',
                gpu: 'DirectX 11 GPU',
            },
            recommended: {},
        },
    });
});

test('GOG normalizer accepts real productcardData system requirements shape', () => {
    const game = normalizeGogRelease({
        external_id: '56357637709878931',
        title: { '*': 'The Whisperer' },
        _storePage: {
            html: `
                <script>
                    window.productcardData = {
                        cardProduct: {
                            "supportedOperatingSystems": [{
                                "operatingSystem": { "name": "windows" },
                                "systemRequirements": [{
                                    "type": "minimum",
                                    "requirements": [
                                        { "id": "system", "name": "System:", "description": "Windows 8" },
                                        { "id": "processor", "name": "Processor:", "description": "i5 2400 3.10 GHz" },
                                        { "id": "memory", "name": "Memory:", "description": "4 GB RAM" },
                                        { "id": "graphics", "name": "Graphics:", "description": "GTX 670" },
                                        { "id": "storage", "name": "Storage:", "description": "4750 MB available space" }
                                    ]
                                }]
                            }]
                        }
                    };
                </script>
            `,
        },
    }, { id: 'acct-1', displayName: 'Real GOG' }, { now: () => 'now' });

    assert.deepEqual(game.info.requirements, {
        win: {
            minimum: {
                os: 'Windows 8',
                cpu: 'i5 2400 3.10 GHz',
                ram: '4 GB RAM',
                gpu: 'GTX 670',
                storage: '4750 MB available space',
            },
            recommended: {},
        },
    });
});

test('GOG normalizer prefers visible store release date over catalog metadata', () => {
    const game = normalizeGogRelease({
        external_id: '56357637709878931',
        title: { '*': 'The Whisperer' },
        _storeProduct: {
            releaseDate: '2023-03-31T14:55:00+02:00',
        },
        _storePage: {
            html: `
                <section>
                    <span>Release:</span>
                    <strong>December 16, 2021</strong>
                </section>
            `,
        },
    }, { id: 'acct-1', displayName: 'Real GOG' }, { now: () => 'now' });

    assert.equal(game.info.releaseDate, '2021-12-16');
});

test('GOG merge clears stale automatic logo when fresh GamesDB data has no safe logo', () => {
    const merged = new Map([
        ['gog_42', {
            id: 'gog_42',
            logoUrl: 'file:///stale-gog-logo.webp',
            logo: 'file:///stale-gog-logo.webp',
            ownedBy: ['Old'],
            ownedByAccountIds: ['old'],
        }],
    ]);
    mergeGogGames(merged, [{
        id: 'gog_42',
        logoUrl: null,
        ownedBy: ['New'],
        ownedByAccountIds: ['new'],
    }], { id: 'new', displayName: 'New' });

    assert.equal(merged.get('gog_42').logoUrl, null);
    assert.equal(merged.get('gog_42').logo, null);
});
