const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const playAdapter = require('../src/features/games/application/services/PlayLauncherArtworkAdapter');
const detailsAdapter = require('../src/features/games/application/services/GameDetailsArtworkAdapter');
const allGamesAdapter = require('../src/features/games/application/services/AllGamesArtworkAdapter');
const { resolveGameArtwork } = require('../src/features/games/application/services/GameArtworkResolver');

const ROOT = path.resolve(__dirname, '..');
const playLauncherPath = path.join(ROOT, 'src/js/play-launcher.js');
const gameDetailsPath = path.join(ROOT, 'src/js/game-details.js');
const dashboardPath = path.join(ROOT, 'src/dashboard.html');
const protectedBuildPath = path.join(ROOT, 'scripts/build-protected.js');
const mainPath = path.join(ROOT, 'main.js');
const preloadPath = path.join(ROOT, 'preload.js');

function read(relPath) {
    return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function resolve(input) {
    return playAdapter.resolvePlayLauncherArtwork(input);
}

test('Play Launcher adapter calls the real GameArtworkResolver path', () => {
    const result = resolve({
        game: { id: 'g1', image: 'db-cover.jpg' },
        metadataArtwork: { cover: 'meta-cover.jpg', verified: true },
    });
    assert.equal(result.cover.value, 'db-cover.jpg');
    assert.equal(result.cover.source, 'database');
});

test('Settings cover, hero, and logo beat stale Creator values', () => {
    const result = resolve({
        game: {
            image: 'settings-cover.jpg',
            heroImage: 'settings-hero.jpg',
            logo: 'settings-logo.png',
            customArtworkLocked: true,
            artworkSource: 'settings',
        },
        creatorArtwork: playAdapter.creatorArtworkFromCustomDetails({
            coverImage: 'creator-cover.jpg',
            heroImage: 'creator-hero.jpg',
            logoImage: 'creator-logo.png',
        }),
    });
    assert.equal(result.cover.source, 'settings');
    assert.equal(result.hero.source, 'settings');
    assert.equal(result.logo.source, 'settings');
});

test('Creator wins when Settings is absent', () => {
    const result = resolve({
        game: { image: 'db-cover.jpg', heroImage: 'db-hero.jpg', logo: 'db-logo.png' },
        creatorArtwork: playAdapter.creatorArtworkFromCustomDetails({
            posterImage: 'creator-cover.jpg',
            heroImage: 'creator-hero.jpg',
            logoImage: 'creator-logo.png',
        }),
        metadataArtwork: { cover: 'meta-cover.jpg', hero: 'meta-hero.jpg', logo: 'meta-logo.png', verified: true },
    });
    assert.equal(result.cover.value, 'creator-cover.jpg');
    assert.equal(result.hero.value, 'creator-hero.jpg');
    assert.equal(result.logo.value, 'creator-logo.png');
});

test('Database canonical artwork beats metadata and cache', () => {
    const result = resolve({
        game: { image: 'db-cover.jpg', heroImage: 'db-hero.jpg', logo: 'db-logo.png' },
        metadataArtwork: { cover: 'meta-cover.jpg', hero: 'meta-hero.jpg', logo: 'meta-logo.png', verified: true },
        cacheArtwork: { cover: 'file://cache-cover.webp', hero: 'file://cache-hero.webp', logo: 'file://cache-logo.webp' },
    });
    assert.equal(result.cover.source, 'database');
    assert.equal(result.hero.source, 'database');
    assert.equal(result.logo.source, 'database');
});

test('Verified platform artwork fills missing artwork', () => {
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
        metadataArtwork: { cover: 'meta-cover.jpg', hero: 'meta-hero.jpg', logo: 'meta-logo.png', verified: true, confidence: 0.95 },
    });
    assert.equal(result.cover.source, 'metadata');
    assert.equal(result.hero.source, 'metadata');
    assert.equal(result.logo.source, 'metadata');
});

test('Unverified or low-confidence candidates do not displace valid art', () => {
    const result = resolve({
        game: { image: 'db-cover.jpg', heroImage: 'db-hero.jpg', logo: 'db-logo.png' },
        platformArtwork: { cover: 'platform-cover.jpg', hero: 'platform-hero.jpg', logo: 'platform-logo.png', verified: false },
        metadataArtwork: { cover: 'meta-cover.jpg', hero: 'meta-hero.jpg', logo: 'meta-logo.png', confidence: 0.2 },
    });
    assert.equal(result.cover.value, 'db-cover.jpg');
    assert.equal(result.hero.value, 'db-hero.jpg');
    assert.equal(result.logo.value, 'db-logo.png');
});

test('Cache cannot independently beat Settings or Creator', () => {
    const settings = resolve({
        game: { image: 'settings-cover.jpg', customArtworkLocked: true, artworkSource: 'settings' },
        cacheArtwork: { cover: 'file://cache-cover.webp' },
    });
    const creator = resolve({
        game: {},
        creatorArtwork: playAdapter.creatorArtworkFromCustomDetails({ coverImage: 'creator-cover.jpg' }),
        cacheArtwork: { cover: 'file://cache-cover.webp' },
    });
    assert.equal(settings.cover.source, 'settings');
    assert.equal(settings.cover.value, 'settings-cover.jpg');
    assert.equal(creator.cover.source, 'creator');
    assert.equal(creator.cover.value, 'creator-cover.jpg');
});

test('Legacy aliases remain supported', () => {
    assert.equal(resolve({ game: { coverUrl: 'cover-url.jpg' } }).cover.value, 'cover-url.jpg');
    assert.equal(resolve({ game: { background: 'background.jpg' } }).hero.value, 'background.jpg');
    assert.equal(resolve({ game: { defaultLogo: 'default-logo.png' } }).logo.value, 'default-logo.png');
});

test('Cover, hero, and logo resolve independently', () => {
    const result = resolve({
        game: { image: 'settings-cover.jpg', customArtworkLocked: true, artworkSource: 'settings' },
        creatorArtwork: playAdapter.creatorArtworkFromCustomDetails({ heroImage: 'creator-hero.jpg' }),
        metadataArtwork: { logo: 'meta-logo.png', confidence: 0.9 },
    });
    assert.equal(result.cover.source, 'settings');
    assert.equal(result.hero.source, 'creator');
    assert.equal(result.logo.source, 'metadata');
});

test('Resolver failure uses legacy fallback', () => {
    const result = resolve({
        game: { image: 'legacy-cover.jpg', heroImage: 'legacy-hero.jpg', logo: 'legacy-logo.png' },
        resolver: () => { throw new Error('boom'); },
    });
    assert.equal(result.cover.source, 'legacy-fallback');
    assert.equal(result.hero.source, 'legacy-fallback');
    assert.equal(result.logo.source, 'legacy-fallback');
});

test('Missing artwork preserves placeholders', () => {
    const result = resolve({ game: {} });
    assert.equal(result.cover.value, null);
    assert.equal(result.hero.value, null);
    assert.equal(result.logo.value, null);
    assert.equal(result.cover.source, 'placeholder');
});

test('Inputs are not mutated', () => {
    const game = Object.freeze({ image: 'db-cover.jpg', allIds: Object.freeze({ steam: '10' }) });
    const metadataArtwork = Object.freeze({ cover: 'meta-cover.jpg', verified: true });
    const beforeGame = JSON.stringify(game);
    const beforeMeta = JSON.stringify(metadataArtwork);
    resolve({ game, metadataArtwork });
    assert.equal(JSON.stringify(game), beforeGame);
    assert.equal(JSON.stringify(metadataArtwork), beforeMeta);
});

test('Play Launcher display resolution performs no storage or database writes', () => {
    const src = fs.readFileSync(playLauncherPath, 'utf8');
    const helper = src.slice(src.indexOf('function _plResolveArtworkForDisplay'), src.indexOf('async function _plResolveLaunchOverlayAssets'));
    assert.doesNotMatch(helper, /localStorage\.setItem|saveMetadata|updateGameMetadata|saveFullMetadata|cacheAllAssets|getGames\(|getGameById/);
});

test('Launch behavior remains reachable and unchanged', () => {
    const src = fs.readFileSync(playLauncherPath, 'utf8');
    assert.match(src, /window\.openPlayLauncher = async function\(game\)/);
    assert.match(src, /await _plDoActualLaunch\(gameToLaunch\)/);
    assert.match(src, /window\.electronAPI\.launchGame\(/);
    assert.match(src, /const overlayAssets = await _plResolveLaunchOverlayAssets\(game\)/);
});

test('All Games and Game Details integrations remain present', () => {
    assert.match(read('src/features/games/application/services/AllGamesArtworkAdapter.js'), /resolveAllGamesArtwork/);
    assert.match(read('src/features/games/application/services/GameDetailsArtworkAdapter.js'), /resolveGameDetailsArtwork/);
    assert.match(read('src/features/games/application/services/PlayLauncherArtworkAdapter.js'), /resolvePlayLauncherArtwork/);
});

test('Cross-surface equivalent inputs resolve to the same decisions', () => {
    const input = {
        game: {
            id: 'g1',
            image: 'db-cover.jpg',
            heroImage: 'db-hero.jpg',
            logo: 'db-logo.png',
            customArtworkLocked: true,
            artworkSource: 'settings',
            artworkUpdatedAt: 200,
        },
        creatorArtwork: playAdapter.creatorArtworkFromCustomDetails({
            coverImage: 'creator-cover.jpg',
            heroImage: 'creator-hero.jpg',
            logoImage: 'creator-logo.png',
        }),
        metadataArtwork: { cover: 'meta-cover.jpg', hero: 'meta-hero.jpg', logo: 'meta-logo.png', verified: true },
    };
    const allGamesCover = allGamesAdapter.resolveAllGamesArtwork(input).cover;
    const details = detailsAdapter.resolveGameDetailsArtwork(input);
    const play = playAdapter.resolvePlayLauncherArtwork(input);
    const canonical = resolveGameArtwork({
        ...input,
        settingsArtwork: playAdapter.explicitSettingsArtworkFromGame(input.game),
    });

    assert.equal(allGamesCover.value, details.cover.value);
    assert.equal(allGamesCover.value, play.cover.value);
    assert.equal(play.cover.value, canonical.cover.value);
    assert.equal(play.hero.value, details.hero.value);
    assert.equal(play.hero.value, canonical.hero.value);
    assert.equal(play.logo.value, details.logo.value);
    assert.equal(play.logo.value, canonical.logo.value);
});

test('Settings and Creator write paths remain unchanged', () => {
    const src = fs.readFileSync(gameDetailsPath, 'utf8');
    assert.match(src, /window\.gdCreatorSave = async function/);
    assert.match(src, /artworkSource:\s*'creator'/);
    assert.match(read('tests/artworkOwnership.test.js'), /saveGameSettings: writes artworkSource settings not creator/);
});

test('Script order is correct', () => {
    const src = fs.readFileSync(dashboardPath, 'utf8');
    assert.ok(src.indexOf('ArtworkOwnershipPolicy.js') < src.indexOf('GameArtworkResolver.js'));
    assert.ok(src.indexOf('GameArtworkResolver.js') < src.indexOf('PlayLauncherArtworkAdapter.js'));
    assert.ok(src.indexOf('PlayLauncherArtworkAdapter.js') < src.indexOf('js/play-launcher.js'));
});

test('Protected renderer concatenation is safe', () => {
    const src = fs.readFileSync(protectedBuildPath, 'utf8');
    assert.ok(src.indexOf("ArtworkOwnershipPolicy.js") < src.indexOf("GameArtworkResolver.js"));
    assert.ok(src.indexOf("GameArtworkResolver.js") < src.indexOf("PlayLauncherArtworkAdapter.js"));
    assert.ok(src.indexOf("PlayLauncherArtworkAdapter.js") < src.indexOf("src/js/play-launcher.js"));
    const adapterSrc = read('src/features/games/application/services/PlayLauncherArtworkAdapter.js');
    assert.match(adapterSrc, /;\(function \(\) \{/);
    assert.match(adapterSrc, /BaddelPlayLauncherArtworkAdapter/);
});

test('IPC, preload, and main remain unchanged by Play Launcher resolver integration', () => {
    assert.doesNotMatch(fs.readFileSync(mainPath, 'utf8'), /PlayLauncherArtworkAdapter/);
    assert.doesNotMatch(fs.readFileSync(preloadPath, 'utf8'), /PlayLauncherArtworkAdapter/);
});

test('PlayLauncherArtworkAdapter boundary stays pure', () => {
    const src = read('src/features/games/application/services/PlayLauncherArtworkAdapter.js');
    assert.doesNotMatch(src, /electron|localStorage|fs|repository|platformSync|document|window\.electronAPI/);
    assert.match(src, /require\('\.\/GameArtworkResolver'\)/);
});
