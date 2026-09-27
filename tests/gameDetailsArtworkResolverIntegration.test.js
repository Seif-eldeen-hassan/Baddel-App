const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const adapter = require('../src/features/games/application/services/GameDetailsArtworkAdapter');

const ROOT = path.resolve(__dirname, '..');
const gameDetailsPath = path.join(ROOT, 'src/js/game-details.js');
const playLauncherPath = path.join(ROOT, 'src/js/play-launcher.js');
const dashboardPath = path.join(ROOT, 'src/dashboard.html');
const protectedBuildPath = path.join(ROOT, 'scripts/build-protected.js');
const allGamesAdapterPath = path.join(ROOT, 'src/features/games/application/services/AllGamesArtworkAdapter.js');
const mainPath = path.join(ROOT, 'main.js');
const preloadPath = path.join(ROOT, 'preload.js');

function read(relPath) {
    return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function resolve(input) {
    return adapter.resolveGameDetailsArtwork(input);
}

test('Game Details adapter calls the real GameArtworkResolver path', () => {
    const result = resolve({
        game: { id: 'g1', image: 'db-cover.jpg' },
        metadataArtwork: { cover: 'meta-cover.jpg', verified: true },
    });
    assert.equal(result.cover.value, 'db-cover.jpg');
    assert.equal(result.cover.source, 'database');
});

test('Settings cover beats stale Creator poster/cover', () => {
    const result = resolve({
        game: { image: 'settings-cover.jpg', customArtworkLocked: true, artworkSource: 'settings' },
        creatorArtwork: adapter.creatorArtworkFromCustomDetails({ posterImage: 'creator-cover.jpg' }),
    });
    assert.equal(result.cover.value, 'settings-cover.jpg');
    assert.equal(result.cover.source, 'settings');
});

test('Settings hero beats stale Creator hero', () => {
    const result = resolve({
        game: { heroImage: 'settings-hero.jpg', customArtworkLocked: true, artworkSource: 'settings' },
        creatorArtwork: adapter.creatorArtworkFromCustomDetails({ heroImage: 'creator-hero.jpg' }),
    });
    assert.equal(result.hero.value, 'settings-hero.jpg');
    assert.equal(result.hero.source, 'settings');
});

test('Settings logo beats stale Creator logo', () => {
    const result = resolve({
        game: { logo: 'settings-logo.png', customArtworkLocked: true, artworkSource: 'settings' },
        creatorArtwork: adapter.creatorArtworkFromCustomDetails({ logoImage: 'creator-logo.png' }),
    });
    assert.equal(result.logo.value, 'settings-logo.png');
    assert.equal(result.logo.source, 'settings');
});

test('Creator cover wins when Settings cover is absent', () => {
    const result = resolve({
        game: { image: 'db-cover.jpg' },
        creatorArtwork: adapter.creatorArtworkFromCustomDetails({ coverImage: 'creator-cover.jpg' }),
        metadataArtwork: { cover: 'meta-cover.jpg', verified: true },
    });
    assert.equal(result.cover.value, 'creator-cover.jpg');
    assert.equal(result.cover.source, 'creator');
});

test('Creator hero wins when Settings hero is absent', () => {
    const result = resolve({
        game: { heroImage: 'db-hero.jpg' },
        creatorArtwork: adapter.creatorArtworkFromCustomDetails({ heroImage: 'creator-hero.jpg' }),
    });
    assert.equal(result.hero.value, 'creator-hero.jpg');
    assert.equal(result.hero.source, 'creator');
});

test('Creator logo wins when Settings logo is absent', () => {
    const result = resolve({
        game: { logo: 'db-logo.png' },
        creatorArtwork: adapter.creatorArtworkFromCustomDetails({ logoImage: 'creator-logo.png' }),
    });
    assert.equal(result.logo.value, 'creator-logo.png');
    assert.equal(result.logo.source, 'creator');
});

test('Database canonical artwork beats metadata/cache', () => {
    const result = resolve({
        game: { image: 'db-cover.jpg', heroImage: 'db-hero.jpg', logo: 'db-logo.png' },
        metadataArtwork: { cover: 'meta-cover.jpg', hero: 'meta-hero.jpg', logo: 'meta-logo.png', verified: true },
        cacheArtwork: { cover: 'file://cache-cover.webp', hero: 'file://cache-hero.webp', logo: 'file://cache-logo.webp' },
    });
    assert.equal(result.cover.source, 'database');
    assert.equal(result.hero.source, 'database');
    assert.equal(result.logo.source, 'database');
});

test('Verified platform artwork fills missing canonical artwork', () => {
    const result = resolve({
        game: { id: 'g1', allIds: { steam: '10' } },
        platformArtwork: {
            cover: 'platform-cover.jpg',
            hero: 'platform-hero.jpg',
            logo: 'platform-logo.png',
            verified: true,
            identity: { gameId: 'g1', appId: '10' },
        },
    });
    assert.equal(result.cover.source, 'platform');
    assert.equal(result.hero.source, 'platform');
    assert.equal(result.logo.source, 'platform');
});

test('Verified high-confidence metadata fills missing artwork', () => {
    const result = resolve({
        game: { id: 'g1' },
        metadataArtwork: { cover: 'meta-cover.jpg', hero: 'meta-hero.jpg', logo: 'meta-logo.png', confidence: 0.9 },
    });
    assert.equal(result.cover.source, 'metadata');
    assert.equal(result.hero.source, 'metadata');
    assert.equal(result.logo.source, 'metadata');
});

test('Unverified platform artwork does not displace a valid database candidate', () => {
    const result = resolve({
        game: { image: 'db-cover.jpg' },
        platformArtwork: { cover: 'platform-cover.jpg', verified: false },
    });
    assert.equal(result.cover.value, 'db-cover.jpg');
    assert.equal(result.cover.source, 'database');
});

test('Low-confidence metadata does not displace valid artwork', () => {
    const result = resolve({
        game: { image: 'db-cover.jpg' },
        metadataArtwork: { cover: 'meta-cover.jpg', confidence: 0.2 },
    });
    assert.equal(result.cover.value, 'db-cover.jpg');
    assert.equal(result.cover.source, 'database');
});

test('localStorage cache cannot independently beat Settings', () => {
    const result = resolve({
        game: { image: 'settings-cover.jpg', customArtworkLocked: true, artworkSource: 'settings' },
        cacheArtwork: { cover: 'local-storage-cover.jpg' },
    });
    assert.equal(result.cover.value, 'settings-cover.jpg');
    assert.equal(result.cover.source, 'settings');
});

test('disk cache cannot independently beat Creator', () => {
    const result = resolve({
        game: {},
        creatorArtwork: adapter.creatorArtworkFromCustomDetails({ posterImage: 'creator-cover.jpg' }),
        cacheArtwork: { cover: 'file://disk-cover.webp' },
    });
    assert.equal(result.cover.value, 'creator-cover.jpg');
    assert.equal(result.cover.source, 'creator');
});

test('cache representation preserves authoritative source where supported', () => {
    const result = resolve({
        game: { image: 'db-cover.jpg' },
        cacheArtwork: { cover: { value: 'file://db-cover.webp', representsSource: 'database' } },
    });
    assert.equal(result.cover.value, 'file://db-cover.webp');
    assert.equal(result.cover.source, 'database');
});

test('legacy aliases remain supported for cover', () => {
    assert.equal(resolve({ game: { coverUrl: 'cover-url.jpg' } }).cover.value, 'cover-url.jpg');
    assert.equal(resolve({ game: { defaultImage: 'default-cover.jpg' } }).cover.value, 'default-cover.jpg');
    assert.equal(resolve({ game: { posterImage: 'poster.jpg' } }).cover.value, 'poster.jpg');
});

test('legacy aliases remain supported for hero', () => {
    assert.equal(resolve({ game: { heroUrl: 'hero-url.jpg' } }).hero.value, 'hero-url.jpg');
    assert.equal(resolve({ game: { defaultHero: 'default-hero.jpg' } }).hero.value, 'default-hero.jpg');
    assert.equal(resolve({ game: { background: 'background.jpg' } }).hero.value, 'background.jpg');
});

test('legacy aliases remain supported for logo', () => {
    assert.equal(resolve({ game: { logoUrl: 'logo-url.png' } }).logo.value, 'logo-url.png');
    assert.equal(resolve({ game: { defaultLogo: 'default-logo.png' } }).logo.value, 'default-logo.png');
    assert.equal(resolve({ game: { logoImage: 'logo-image.png' } }).logo.value, 'logo-image.png');
});

test('conflicting aliases resolve deterministically', () => {
    const result = resolve({ game: { image: 'image.jpg', coverUrl: 'cover-url.jpg', defaultImage: 'default.jpg' } });
    assert.equal(result.cover.value, 'image.jpg');
    assert.equal(result.cover.source, 'database');
});

test('cover, hero, and logo may have different winners', () => {
    const result = resolve({
        game: { image: 'settings-cover.jpg', customArtworkLocked: true, artworkSource: 'settings' },
        creatorArtwork: adapter.creatorArtworkFromCustomDetails({ heroImage: 'creator-hero.jpg' }),
        metadataArtwork: { logo: 'meta-logo.png', confidence: 0.9 },
    });
    assert.equal(result.cover.source, 'settings');
    assert.equal(result.hero.source, 'creator');
    assert.equal(result.logo.source, 'metadata');
});

test('missing resolver output uses legacy fallback', () => {
    const result = resolve({
        game: { image: 'legacy-cover.jpg' },
        resolver: () => ({ cover: null, hero: null, logo: null }),
    });
    assert.equal(result.cover.value, 'legacy-cover.jpg');
    assert.equal(result.cover.source, 'legacy-fallback');
});

test('resolver exception uses legacy fallback', () => {
    const result = resolve({
        game: { image: 'legacy-cover.jpg' },
        resolver: () => { throw new Error('boom'); },
    });
    assert.equal(result.cover.value, 'legacy-cover.jpg');
    assert.equal(result.cover.source, 'legacy-fallback');
});

test('missing artwork preserves existing placeholder result', () => {
    const result = resolve({ game: {} });
    assert.equal(result.cover.value, null);
    assert.equal(result.cover.source, 'placeholder');
});

test('adapter does not mutate input game', () => {
    const game = Object.freeze({ image: 'db-cover.jpg', allIds: Object.freeze({ steam: '10' }) });
    const before = JSON.stringify(game);
    resolve({ game, metadataArtwork: { cover: 'meta-cover.jpg', verified: true } });
    assert.equal(JSON.stringify(game), before);
});

test('display resolution performs no DB write', () => {
    const gameDetails = fs.readFileSync(gameDetailsPath, 'utf8');
    const helper = gameDetails.slice(gameDetails.indexOf('function _gdResolveArtworkForDisplay'), gameDetails.indexOf('function _gdPopulateBasic'));
    assert.doesNotMatch(helper, /updateGameMetadata|saveMetadata|save-game-metadata|getGames\(|getGameById/);
});

test('display resolution performs no localStorage write', () => {
    const gameDetails = fs.readFileSync(gameDetailsPath, 'utf8');
    const helper = gameDetails.slice(gameDetails.indexOf('function _gdResolveArtworkForDisplay'), gameDetails.indexOf('function _gdPopulateBasic'));
    assert.doesNotMatch(helper, /localStorage\.setItem|_gdCreatorSaveStore/);
});

test('display resolution does not trigger metadata persistence', () => {
    const gameDetails = fs.readFileSync(gameDetailsPath, 'utf8');
    const helper = gameDetails.slice(gameDetails.indexOf('function _gdApplyResolvedArtworkToDom'), gameDetails.indexOf('function _gdPopulateBasic'));
    assert.doesNotMatch(helper, /saveFullMetadata|cacheAllAssets|persist/i);
});

test('Game Details hydrates canonical cached artwork before its initial basic render', async () => {
    const src = fs.readFileSync(gameDetailsPath, 'utf8');
    const start = src.indexOf('// Resolve persisted canonical artwork');
    const end = src.indexOf('// ── 4. Merge launch data', start);
    assert.ok(start >= 0 && end > start, 'initial canonical hydration block exists');
    const block = src.slice(start, end);
    const stages = [];
    const cacheCalls = [];
    const canonical = {
        id: 'canonical-1',
        image: 'file://db-cover.webp',
        heroImage: null,
        logo: null,
    };
    const sandbox = {
        window: {
            __baddelCanonicalGames: [canonical],
            BaddelCanonicalArtworkProjection: {
                projectFromRecords(displayGame, records) {
                    const record = records.find(item => item.id === displayGame.localGameId);
                    return record
                        ? { ...displayGame, ...record, localGameId: record.id, _artworkIdentityMatchReason: 'local-game-id' }
                        : displayGame;
                },
            },
            electronAPI: {
                getGameById: async () => { throw new Error('canonical registry should satisfy lookup'); },
            },
            async __baddelLoadCachedArtworkForGame(displayGame, canonicalGame, options) {
                cacheCalls.push({ displayGame, canonicalGame, options });
                return {
                    cover: 'file://cache-cover.webp',
                    hero: 'file://cache-hero.webp',
                    logo: 'file://cache-logo.webp',
                };
            },
        },
        _gdWithTimeout: promise => promise,
        _gdRecordStage: (stage, payload) => stages.push({ stage, payload }),
        String,
        Set,
    };
    const hydrate = vm.runInNewContext(
        `(async function hydrateInitial(game) { const tokenStillValid = () => true; ${block}; return game; })`,
        sandbox,
    );

    const result = await hydrate({ id: 'display-1', localGameId: 'canonical-1', name: 'Cold Start Game' });

    assert.equal(cacheCalls.length, 1);
    assert.equal(cacheCalls[0].canonicalGame.id, 'canonical-1');
    assert.deepEqual(Array.from(cacheCalls[0].options.types), ['cover', 'hero', 'logo']);
    assert.equal(result.image, 'file://cache-cover.webp');
    assert.equal(result.heroImage, 'file://cache-hero.webp');
    assert.equal(result.logo, 'file://cache-logo.webp');
    assert.ok(stages.some(entry => entry.stage === 'GD_ARTWORK_CACHE_HYDRATED'));
});

test('_gdApplyExternalPatch re-resolves artwork', () => {
    const src = fs.readFileSync(gameDetailsPath, 'utf8');
    const fn = src.slice(src.indexOf('window._gdApplyExternalPatch'), src.indexOf('window.gdCreatorSave'));
    assert.match(fn, /_gdApplyResolvedArtworkToDom\(_gdCurrentGame,\s*_gdCurrentMeta\)/);
});

test('canonical artwork commits route into an open Game Details surface', () => {
    const src = read('src/js/app/artwork-sync.js');
    const start = src.indexOf('function __baddelCommitCanonicalGameUpdate');
    const end = src.indexOf('window.__baddelCommitCanonicalGameUpdate', start);
    const fn = src.slice(start, end);
    assert.match(fn, /window\._gdApplyExternalPatch/);
    assert.match(fn, /canonicalGame/);
});

test('_gdApplyExternalPatch ignores a different game', () => {
    const src = fs.readFileSync(gameDetailsPath, 'utf8');
    const fn = src.slice(src.indexOf('window._gdApplyExternalPatch'), src.indexOf('window.gdCreatorSave'));
    assert.match(fn, /if \(!mt \|\| mt !== ct\) return;/);
});

test('newer Settings patch beats stale customGameDetails through base snapshot', () => {
    const src = fs.readFileSync(gameDetailsPath, 'utf8');
    assert.match(src, /_gdCurrentBaseGame = typeof _gdClonePlain === 'function' \? _gdClonePlain\(game\) : \{ \.\.\.game \};/);
    assert.match(src, /_gdCurrentBaseGame = typeof _gdClonePlain === 'function' \? _gdClonePlain\(_gdCurrentGame\) : \{ \.\.\._gdCurrentGame \};/);
});

test('All Games integration remains present', () => {
    const src = fs.readFileSync(allGamesAdapterPath, 'utf8');
    assert.match(src, /resolveAllGamesArtwork/);
    assert.match(src, /BaddelAllGamesArtworkAdapter/);
});

test('Play Launcher integration remains present after Game Details integration', () => {
    const src = fs.readFileSync(playLauncherPath, 'utf8');
    assert.match(src, /BaddelPlayLauncherArtworkAdapter/);
    assert.match(read('src/features/games/application/services/PlayLauncherArtworkAdapter.js'), /resolvePlayLauncherArtwork/);
    assert.doesNotMatch(src, /GameDetailsArtworkAdapter|BaddelGameDetailsArtworkAdapter/);
});

test('Creator write path commits canonical artwork through the render coordinator', () => {
    const src = fs.readFileSync(gameDetailsPath, 'utf8');
    const creatorStart = src.indexOf('window.gdCreatorSave = async function');
    const creatorBody = src.slice(creatorStart, src.indexOf('window.gdCreatorCancel', creatorStart));
    assert.match(creatorBody, /setGameArtwork\(creatorIdentity,\s*_creatorArtworkUpdates/);
    assert.match(creatorBody, /source:\s*'creator'/);
    assert.match(creatorBody, /canonicalSavedGame\s*=\s*res\.updatedGame/);
    assert.match(creatorBody, /__baddelCommitCanonicalGameUpdate\(canonicalSavedGame/);
    assert.doesNotMatch(creatorBody, /cover:\s*_creatorDirtyTypes\.cover \? newCover : null/);
    const ownershipTests = fs.readFileSync(path.join(ROOT, 'tests/artworkOwnership.test.js'), 'utf8');
    assert.match(ownershipTests, /saveGameSettings: writes artworkSource settings not creator/);
});

test('IPC/preload/main remain unchanged by Game Details resolver integration', () => {
    assert.doesNotMatch(fs.readFileSync(mainPath, 'utf8'), /GameDetailsArtworkAdapter/);
    assert.doesNotMatch(fs.readFileSync(preloadPath, 'utf8'), /GameDetailsArtworkAdapter/);
});

test('script order is correct in dashboard.html', () => {
    const src = fs.readFileSync(dashboardPath, 'utf8');
    assert.ok(src.indexOf('ArtworkOwnershipPolicy.js') < src.indexOf('GameArtworkResolver.js'));
    assert.ok(src.indexOf('GameArtworkResolver.js') < src.indexOf('GameDetailsArtworkAdapter.js'));
    assert.ok(src.indexOf('GameDetailsArtworkAdapter.js') < src.indexOf('js/game-details.js'));
});

test('protected build source order is correct', () => {
    const src = fs.readFileSync(protectedBuildPath, 'utf8');
    assert.ok(src.indexOf("ArtworkOwnershipPolicy.js") < src.indexOf("GameArtworkResolver.js"));
    assert.ok(src.indexOf("GameArtworkResolver.js") < src.indexOf("GameDetailsArtworkAdapter.js"));
    assert.ok(src.indexOf("GameDetailsArtworkAdapter.js") < src.indexOf("src/js/game-details.js"));
});

test('browser globals are safe for concatenation', () => {
    const src = read('src/features/games/application/services/GameDetailsArtworkAdapter.js');
    assert.match(src, /;\(function \(\) \{/);
    assert.match(src, /BaddelGameDetailsArtworkAdapter/);
});

test('Game Details metadata and installed matching paths remain reachable', () => {
    const src = fs.readFileSync(gameDetailsPath, 'utf8');
    assert.match(src, /_gdFindInstalledLocalMatch/);
    assert.match(src, /_gdPopulateMeta\(game, meta\)/);
    assert.match(src, /loadFullMetadata/);
});

test('Creator preview/edit functions remain reachable', () => {
    const src = fs.readFileSync(gameDetailsPath, 'utf8');
    assert.match(src, /function _gdCreatorApplyDraftToPage/);
    assert.match(src, /window\.gdCreatorSave/);
    assert.match(src, /_creatorCustom/);
});

test('existing image error/fallback handling remains reachable', () => {
    const src = fs.readFileSync(gameDetailsPath, 'utf8');
    assert.match(src, /_gdCoverErrResolved/);
    assert.match(src, /_gdLogoOnErrorResolved/);
    assert.match(src, /_gdApplyProceduralCard/);
    assert.match(src, /_gdApplyProceduralHero/);
});

test('GameDetailsArtworkAdapter boundary stays pure', () => {
    const src = read('src/features/games/application/services/GameDetailsArtworkAdapter.js');
    assert.doesNotMatch(src, /electron|localStorage|fs|repository|platformSync|document|window\.electronAPI/);
    assert.match(src, /require\('\.\/GameArtworkResolver'\)/);
});
