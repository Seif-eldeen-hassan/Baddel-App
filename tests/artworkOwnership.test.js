'use strict';
/**
 * Regression tests: artwork ownership / customArtworkLocked mechanism.
 *
 * Covers:
 *  - updateGameMetadata skips art when customArtworkLocked + source=pipeline
 *  - updateGameMetadata allows art when source=creator regardless of lock
 *  - updateGameMetadata allows art when force=true
 *  - updateGameMetadata sets ownership fields (customArtworkLocked, artworkSource, artworkUpdatedAt)
 *  - logo can be explicitly cleared (logo: null) via updateGameMetadata
 *  - pipeline source tag propagates through backgroundDownload
 *  - runBackgroundMetadataPipeline skips art for locked games
 *  - refetchMissingImages skips locked games
 *  - library-updated merge preserves customArtworkLocked from DB
 *  - fetchMetadata skips stale localStorage for locked games
 *  - gdCreatorSave sets customArtworkLocked and clears stale localStorage
 *  - gdCreatorSave logoMode=text explicitly clears logo
 *  - All Games cache (_allGamesCache) is updated by gdCreatorSave
 *  - Virtual scroller cardCache entry invalidated by gdCreatorSave
 */

const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const os     = require('node:os');
const path   = require('node:path');

process.env.BADDEL_TEST_USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-artwork-ownership-'));

const { BaddelEngine } = require('../gameScanner');

function makeTempDir(prefix = 'baddel-art-') {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeEngine() {
    const dbFolder = makeTempDir();
    return new BaddelEngine({
        dbFolder,
        programData: path.join(dbFolder, 'ProgramData'),
        skipMetadataServerSync: true,
    });
}

async function addTestGame(engine, overrides = {}) {
    const id = 'test-' + Math.random().toString(36).slice(2);
    engine.dbCache.push({
        id,
        name: 'Test Game',
        image: null,
        defaultImage: null,
        heroImage: null,
        defaultHero: null,
        logo: null,
        defaultLogo: null,
        customArtworkLocked: false,
        ...overrides,
    });
    return id;
}

// ── updateGameMetadata: core lock behaviour ─────────────────────────────────

test('updateGameMetadata: pipeline source skips art when customArtworkLocked', async () => {
    const engine = makeEngine();
    const id = await addTestGame(engine, {
        image: 'file://correct.webp',
        customArtworkLocked: true,
    });

    await engine.updateGameMetadata(id, { cover: 'file://wrong.webp' }, { source: 'pipeline' });

    const game = engine.dbCache.find(g => g.id === id);
    assert.equal(game.image, 'file://correct.webp', 'pipeline must not overwrite locked cover');
});

test('updateGameMetadata: server source skips art when customArtworkLocked', async () => {
    const engine = makeEngine();
    const id = await addTestGame(engine, {
        image: 'file://correct.webp',
        customArtworkLocked: true,
    });

    await engine.updateGameMetadata(id, { cover: 'file://wrong.webp' }, { source: 'server' });

    const game = engine.dbCache.find(g => g.id === id);
    assert.equal(game.image, 'file://correct.webp', 'server source must not overwrite locked cover');
});

test('updateGameMetadata: creator source always writes art even when locked', async () => {
    const engine = makeEngine();
    const id = await addTestGame(engine, {
        image: 'file://old.webp',
        customArtworkLocked: true,
    });

    await engine.updateGameMetadata(id, { cover: 'file://new.webp' }, { source: 'creator' });

    const game = engine.dbCache.find(g => g.id === id);
    assert.equal(game.image, 'file://new.webp', 'creator source must overwrite locked cover');
});

test('updateGameMetadata: force=true bypasses lock regardless of source', async () => {
    const engine = makeEngine();
    const id = await addTestGame(engine, {
        image: 'file://old.webp',
        customArtworkLocked: true,
    });

    await engine.updateGameMetadata(id, { cover: 'file://forced.webp' }, { source: 'pipeline', force: true });

    const game = engine.dbCache.find(g => g.id === id);
    assert.equal(game.image, 'file://forced.webp', 'force=true must bypass lock');
});

test('updateGameMetadata: default source (server) writes art when NOT locked', async () => {
    const engine = makeEngine();
    const id = await addTestGame(engine, { image: null, customArtworkLocked: false });

    await engine.updateGameMetadata(id, { cover: 'file://new.webp' });

    const game = engine.dbCache.find(g => g.id === id);
    assert.equal(game.image, 'file://new.webp', 'unlocked game must accept new cover');
});

test('updateGameMetadata: sets ownership fields from metadata', async () => {
    const engine = makeEngine();
    const id = await addTestGame(engine);
    const ts = Date.now();

    await engine.updateGameMetadata(id, {
        cover: 'file://c.webp',
        customArtworkLocked: true,
        artworkSource: 'creator',
        artworkUpdatedAt: ts,
    }, { source: 'creator' });

    const game = engine.dbCache.find(g => g.id === id);
    assert.equal(game.customArtworkLocked, true, 'customArtworkLocked must be set');
    assert.equal(game.artworkSource, 'creator', 'artworkSource must be set');
    assert.equal(game.artworkUpdatedAt, ts, 'artworkUpdatedAt must be set');
});

test('updateGameMetadata: logo=null clears logo fields', async () => {
    const engine = makeEngine();
    const id = await addTestGame(engine, { logo: 'file://old-logo.webp', defaultLogo: 'file://old-logo.webp' });

    await engine.updateGameMetadata(id, { logo: null }, { source: 'creator' });

    const game = engine.dbCache.find(g => g.id === id);
    assert.equal(game.logo, null, 'logo must be cleared');
    assert.equal(game.defaultLogo, null, 'defaultLogo must be cleared');
});

test('updateGameMetadata: logo=null is a no-op when logo key absent from metadata', async () => {
    const engine = makeEngine();
    const id = await addTestGame(engine, { logo: 'file://keep.webp', defaultLogo: 'file://keep.webp' });

    // Pass metadata WITHOUT a 'logo' key — should not touch logo
    await engine.updateGameMetadata(id, { cover: 'file://new.webp' }, { source: 'creator' });

    const game = engine.dbCache.find(g => g.id === id);
    assert.equal(game.logo, 'file://keep.webp', 'logo must not be cleared when key absent from metadata');
});

test('updateGameMetadata: pipeline skips hero when locked', async () => {
    const engine = makeEngine();
    const id = await addTestGame(engine, {
        heroImage: 'file://correct-hero.webp',
        customArtworkLocked: true,
    });

    await engine.updateGameMetadata(id, { hero: 'file://wrong-hero.webp' }, { source: 'pipeline' });

    const game = engine.dbCache.find(g => g.id === id);
    assert.equal(game.heroImage, 'file://correct-hero.webp', 'pipeline must not overwrite locked hero');
});

// ── backgroundDownload passes source through ────────────────────────────────

test('backgroundDownload: source is forwarded to updateGameMetadata', async () => {
    const engine = makeEngine();
    const id = await addTestGame(engine, {
        image: 'file://locked.webp',
        customArtworkLocked: true,
    });

    // Patch downloadToCache to return null (no actual network call)
    engine.downloadToCache = async () => null;

    // Call backgroundDownload with a new cover and pipeline source
    await engine.backgroundDownload(
        { cover: 'https://cdn.example.com/wrong.jpg' },
        id,
        null,
        { source: 'pipeline' }
    );

    const game = engine.dbCache.find(g => g.id === id);
    assert.equal(game.image, 'file://locked.webp', 'backgroundDownload(pipeline) must not overwrite locked cover');
});

// ── gameScanner.js source tagging in pipeline / refetch ────────────────────

test('gameScanner.js: runBackgroundMetadataPipeline passes source=pipeline to updateGameMetadata', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'gameScanner.js'), 'utf8');
    const pipelineStart = src.indexOf('async function runBackgroundMetadataPipeline');
    assert.ok(pipelineStart !== -1, 'runBackgroundMetadataPipeline must exist');
    // Count occurrences of updateGameMetadata calls tagged with source:'pipeline' in the function body.
    // The calls span multiple lines so we count the source tag occurrences co-located with
    // updateGameMetadata within a 6000-char window rather than using a single-line regex.
    const pipelineBody = src.slice(pipelineStart, pipelineStart + 12000);
    const taggedCalls = (pipelineBody.match(/source:\s*['"]pipeline['"]/g) || []).length;
    assert.ok(taggedCalls >= 3, `must have ≥3 source:'pipeline' tags in pipeline body, found ${taggedCalls}`);
});

test('gameScanner.js: refetchMissingImages skips customArtworkLocked games', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'gameScanner.js'), 'utf8');
    const fnStart = src.indexOf('async function refetchMissingImages');
    assert.ok(fnStart !== -1, 'refetchMissingImages must exist');
    const fnBody = src.slice(fnStart, fnStart + 800);
    assert.match(fnBody, /customArtworkLocked/, 'refetchMissingImages must check customArtworkLocked');
});

// ── app.js: library-updated merge and fetchMetadata ────────────────────────

test('app.js: library-updated merge propagates customArtworkLocked', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'app.js'), 'utf8');
    const mergeStart = src.indexOf('onLibraryUpdated');
    assert.ok(mergeStart !== -1, 'onLibraryUpdated must exist');
    const mergeBody = src.slice(mergeStart, mergeStart + 1200);
    assert.match(mergeBody, /customArtworkLocked/, 'library-updated merge must handle customArtworkLocked');
});

test('app.js: fetchMetadata short-circuits for customArtworkLocked games', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'app.js'), 'utf8');
    const fnStart = src.indexOf('async function fetchMetadata');
    assert.ok(fnStart !== -1, 'fetchMetadata must exist');
    const fnBody = src.slice(fnStart, fnStart + 1500);
    assert.match(fnBody, /customArtworkLocked/, 'fetchMetadata must check customArtworkLocked');
});

// ── game-details.js: gdCreatorSave ownership and cache invalidation ─────────

test('gdCreatorSave: sets customArtworkLocked and artworkSource in IPC payload', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'game-details.js'), 'utf8');
    // Use the assignment form to find the actual function definition, not an earlier reference call
    const fnStart = src.indexOf('window.gdCreatorSave = async function');
    assert.ok(fnStart !== -1, 'gdCreatorSave must exist');
    const fnBody = src.slice(fnStart, fnStart + 25000);
    assert.match(fnBody, /customArtworkLocked.*true|true.*customArtworkLocked/, 'must set customArtworkLocked: true');
    assert.match(fnBody, /artworkSource.*creator|creator.*artworkSource/, 'must set artworkSource: creator');
    assert.match(fnBody, /artworkUpdatedAt/, 'must set artworkUpdatedAt');
});

test('gdCreatorSave: passes source=creator to saveMetadata IPC', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'game-details.js'), 'utf8');
    const fnStart = src.indexOf('window.gdCreatorSave = async function');
    const fnBody = src.slice(fnStart, fnStart + 25000);
    assert.match(fnBody, /saveMetadata\(gameId.*source.*creator|source.*creator.*saveMetadata/s, 'must call saveMetadata with source=creator');
});

test('gdCreatorSave: updates localStorage cover/hero/logo keys', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'game-details.js'), 'utf8');
    const fnStart = src.indexOf('window.gdCreatorSave = async function');
    const fnBody = src.slice(fnStart, fnStart + 25000);
    // Creator purges localStorage cache keys so images are re-fetched from new saved values
    assert.match(fnBody, /localStorage\.removeItem\(['"]cover_/, 'must removeItem cover_ from localStorage cache');
    assert.match(fnBody, /localStorage\.removeItem\(['"]hero_/,  'must removeItem hero_ from localStorage cache');
    assert.match(fnBody, /localStorage\.removeItem\(['"]logo_/, 'must removeItem logo_ when cleared');
});

test('gdCreatorSave: logoMode=text sends logo:null in IPC meta', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'game-details.js'), 'utf8');
    const fnStart = src.indexOf('window.gdCreatorSave = async function');
    const fnBody = src.slice(fnStart, fnStart + 25000);
    assert.match(fnBody, /logoCleared|logoMode.*text|text.*logo/, 'must detect logoMode=text for logo clear');
    assert.match(fnBody, /logo.*null|null.*logo/, 'must set logo:null when clearing');
});

test('gdCreatorSave: updates window._allGamesCache', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'game-details.js'), 'utf8');
    const fnStart = src.indexOf('window.gdCreatorSave = async function');
    const fnBody = src.slice(fnStart, fnStart + 25000);
    assert.match(fnBody, /_allGamesCache/, 'must update window._allGamesCache');
});

test('gdCreatorSave: invalidates virtual scroller cardCache for updated game', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'game-details.js'), 'utf8');
    const fnStart = src.indexOf('window.gdCreatorSave = async function');
    const fnBody = src.slice(fnStart, fnStart + 25000);
    // Implementation uses cardCache.clear() to purge the entire map in one step
    assert.match(fnBody, /cardCache\.clear\(\)|cardCache.*delete/, 'must invalidate _vs.cardCache');
});

test('gdCreatorSave: is declared async', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'game-details.js'), 'utf8');
    assert.match(src, /window\.gdCreatorSave\s*=\s*async\s+function/, 'gdCreatorSave must be async');
});

// ── preload.js and main.js wiring ────────────────────────────────────────────

test('preload.js: saveMetadata accepts opts parameter', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
    assert.match(src, /saveMetadata.*gameId.*meta.*opts/, 'saveMetadata must accept opts');
    assert.match(src, /save-game-metadata.*gameId.*meta.*opts/, 'must pass opts to IPC');
});

test('main.js: save-game-metadata handler forwards opts to updateGameMetadata', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'handlers/localMetadataHandlers.js'), 'utf8');
    const idx = src.indexOf("'save-game-metadata'");
    assert.ok(idx !== -1, 'save-game-metadata handler must exist');
    const snippet = src.slice(idx, idx + 150);
    assert.match(snippet, /opts/, 'save-game-metadata handler must pass opts');
});

// ── server-details source: Game Details explicit resolve protection ──────────

test('server-details: pipeline cannot overwrite server-details-verified artwork', async () => {
    const engine = makeEngine();
    // Step 1 — manual add gives wrong cover (addManual source)
    const id = await addTestGame(engine, { image: 'file://wrong.webp', defaultImage: 'file://wrong.webp' });

    // Step 2 — Game Details opens, resolves correct artwork, saves with server-details
    await engine.updateGameMetadata(id, {
        cover:            'file://correct.webp',
        artworkSource:    'server-details',
        artworkUpdatedAt: Date.now(),
    }, { source: 'server-details' });

    let game = engine.dbCache.find(g => g.id === id);
    assert.equal(game.image, 'file://correct.webp', 'server-details save must write correct cover');
    assert.equal(game.artworkSource, 'server-details', 'artworkSource must be set');
    assert.ok(game.artworkUpdatedAt > 0, 'artworkUpdatedAt must be set');

    // Step 3 — delayed backgroundDownload / pipeline tries to write old wrong cover
    await engine.updateGameMetadata(id, { cover: 'file://wrong.webp' }, { source: 'pipeline' });

    game = engine.dbCache.find(g => g.id === id);
    // Step 4 — final image must remain the correct GD-resolved cover
    assert.equal(game.image, 'file://correct.webp', 'pipeline must not overwrite server-details cover');
    assert.equal(game.defaultImage, 'file://correct.webp', 'defaultImage must remain correct');
});

test('server-details: addManual backgroundDownload cannot overwrite server-details cover', async () => {
    const engine = makeEngine();
    const id = await addTestGame(engine, { image: 'file://wrong.webp' });

    await engine.updateGameMetadata(id, {
        cover:            'file://correct.webp',
        artworkSource:    'server-details',
        artworkUpdatedAt: Date.now(),
    }, { source: 'server-details' });

    // Simulate delayed addManual backgroundDownload (source='addManual')
    await engine.updateGameMetadata(id, { cover: 'file://wrong.webp' }, { source: 'addManual' });

    const game = engine.dbCache.find(g => g.id === id);
    assert.equal(game.image, 'file://correct.webp', 'addManual must not overwrite server-details cover');
});

test('server-details: fresh server-details write CAN overwrite an older server-details entry', async () => {
    const engine = makeEngine();
    const id = await addTestGame(engine);

    const ts1 = Date.now() - 5000;
    await engine.updateGameMetadata(id, {
        cover:            'file://first.webp',
        artworkSource:    'server-details',
        artworkUpdatedAt: ts1,
    }, { source: 'server-details' });

    // A newer GD resolve (e.g. user re-opened Game Details) replaces with better art
    await engine.updateGameMetadata(id, {
        cover:            'file://better.webp',
        artworkSource:    'server-details',
        artworkUpdatedAt: Date.now(),
    }, { source: 'server-details' });

    const game = engine.dbCache.find(g => g.id === id);
    assert.equal(game.image, 'file://better.webp', 'newer server-details write must win');
});

test('server-details: creator write always beats server-details', async () => {
    const engine = makeEngine();
    const id = await addTestGame(engine);

    await engine.updateGameMetadata(id, {
        cover:            'file://server-art.webp',
        artworkSource:    'server-details',
        artworkUpdatedAt: Date.now(),
    }, { source: 'server-details' });

    await engine.updateGameMetadata(id, {
        cover:               'file://creator-art.webp',
        customArtworkLocked: true,
        artworkSource:       'creator',
        artworkUpdatedAt:    Date.now(),
    }, { source: 'creator' });

    const game = engine.dbCache.find(g => g.id === id);
    assert.equal(game.image, 'file://creator-art.webp', 'creator must overwrite server-details');
    assert.equal(game.customArtworkLocked, true, 'customArtworkLocked must be set by creator');
});

test('server-details: creator-locked artwork blocks server-details writes', async () => {
    const engine = makeEngine();
    const id = await addTestGame(engine, { image: 'file://creator.webp', customArtworkLocked: true });

    await engine.updateGameMetadata(id, {
        cover:            'file://server-art.webp',
        artworkSource:    'server-details',
        artworkUpdatedAt: Date.now(),
    }, { source: 'server-details' });

    const game = engine.dbCache.find(g => g.id === id);
    assert.equal(game.image, 'file://creator.webp', 'server-details must not overwrite creator-locked art');
});

test('server-details: hero and logo are also protected from pipeline', async () => {
    const engine = makeEngine();
    const id = await addTestGame(engine, { heroImage: 'file://wrong-hero.webp', logo: 'file://wrong-logo.webp' });

    await engine.updateGameMetadata(id, {
        hero:             'file://correct-hero.webp',
        logo:             'file://correct-logo.webp',
        artworkSource:    'server-details',
        artworkUpdatedAt: Date.now(),
    }, { source: 'server-details' });

    await engine.updateGameMetadata(id, {
        hero: 'file://wrong-hero.webp',
        logo: 'file://wrong-logo.webp',
    }, { source: 'pipeline' });

    const game = engine.dbCache.find(g => g.id === id);
    assert.equal(game.heroImage, 'file://correct-hero.webp', 'pipeline must not overwrite server-details hero');
    assert.equal(game.logo,      'file://correct-logo.webp', 'pipeline must not overwrite server-details logo');
});

test('server-details: default server source (processQueue) CAN still update art', async () => {
    const engine = makeEngine();
    const id = await addTestGame(engine, { image: 'file://old.webp' });

    await engine.updateGameMetadata(id, {
        cover:            'file://gd.webp',
        artworkSource:    'server-details',
        artworkUpdatedAt: Date.now(),
    }, { source: 'server-details' });

    // Default 'server' source (from processQueue cacheAllAssets callback) is NOT blocked
    await engine.updateGameMetadata(id, { cover: 'file://fresh-server.webp' }, { source: 'server' });

    const game = engine.dbCache.find(g => g.id === id);
    assert.equal(game.image, 'file://fresh-server.webp', 'default server source must still update server-details art');
});

// ── game-details.js: saveMetadata calls tagged with server-details ──────────

test('game-details.js: fallback path saveMetadata calls use source=server-details', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'game-details.js'), 'utf8');
    // Count how many saveMetadata IPC calls in game-details.js include source:'server-details'
    const tagged = (src.match(/saveMetadata\([^)]*source.*server-details|source.*server-details[^)]*saveMetadata/g) || []).length;
    // Check by counting occurrences of the pattern around saveMetadata calls
    const serverDetailsSaves = (src.match(/'server-details'/g) || []).length;
    // Should have at least 3: path-C-then, path-C-catch, path-E-then
    assert.ok(serverDetailsSaves >= 3, `game-details.js must have ≥3 server-details tags, found ${serverDetailsSaves}`);
});

test('game-details.js: fallback path saveMetadata calls include artworkSource and artworkUpdatedAt', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'game-details.js'), 'utf8');
    // Find the cached fallback section (path C)
    const pathC = src.indexOf('Cache images locally and persist URLs back into the game DB entry');
    assert.ok(pathC !== -1, 'path C comment must exist');
    const pathCBody = src.slice(pathC, pathC + 1800);
    assert.match(pathCBody, /artworkSource/, 'path C saveMetadata must include artworkSource');
    assert.match(pathCBody, /artworkUpdatedAt/, 'path C saveMetadata must include artworkUpdatedAt');
});

test('JsonGameRepository.js: updateGameMetadata skip logic references serverVerified and server-details', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'features', 'games', 'infrastructure', 'repositories', 'JsonGameRepository.js'), 'utf8');
    const fnStart = src.indexOf('async updateGameMetadata');
    assert.ok(fnStart !== -1);
    const fnBody = src.slice(fnStart, fnStart + 1200);
    assert.match(fnBody, /server-details/, 'updateGameMetadata must reference server-details source');
    assert.match(fnBody, /serverVerified/, 'updateGameMetadata must use serverVerified check');
    assert.match(fnBody, /artworkUpdatedAt/, 'updateGameMetadata must check artworkUpdatedAt');
});

// ── Metadata sync: saveGameSettings alias fields ────────────────────────────

test('saveGameSettings: cover update sets coverUrl and defaultImage aliases', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'addGameModal.js'), 'utf8');
    const fnStart = src.indexOf('async function saveGameSettings');
    assert.ok(fnStart !== -1, 'saveGameSettings must exist');
    const fnBody = src.slice(fnStart, fnStart + 3000);
    assert.match(fnBody, /g\.coverUrl\s*=/, 'saveGameSettings must set g.coverUrl on cover update');
    assert.match(fnBody, /g\.defaultImage\s*=/, 'saveGameSettings must set g.defaultImage on cover update');
    assert.match(fnBody, /g\.heroUrl\s*=/, 'saveGameSettings must set g.heroUrl on hero update');
    assert.match(fnBody, /g\.defaultHero\s*=/, 'saveGameSettings must set g.defaultHero on hero update');
    assert.match(fnBody, /g\.logoUrl\s*=/, 'saveGameSettings must set g.logoUrl on logo update');
    assert.match(fnBody, /g\.defaultLogo\s*=/, 'saveGameSettings must set g.defaultLogo on logo update');
});

test('saveGameSettings: calls window.__baddelApplyGameCustomOverride with accumulated patch', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'addGameModal.js'), 'utf8');
    const fnStart = src.indexOf('async function saveGameSettings');
    assert.ok(fnStart !== -1, 'saveGameSettings must exist');
    const fnBody = src.slice(fnStart, fnStart + 5000);
    assert.match(fnBody, /__baddelApplyGameCustomOverride/, 'saveGameSettings must call window.__baddelApplyGameCustomOverride');
    assert.match(fnBody, /_patch/, 'saveGameSettings must accumulate a patch object for __baddelApplyGameCustomOverride');
});

// ── Metadata sync: gdCreatorSave propagates to synced stores ────────────────

test('gdCreatorSave: calls window.__baddelApplyGameCustomOverride for synced store propagation', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'game-details.js'), 'utf8');
    const fnStart = src.indexOf('window.gdCreatorSave = async function');
    assert.ok(fnStart !== -1, 'gdCreatorSave must exist');
    const fnBody = src.slice(fnStart, fnStart + 25000);
    assert.match(fnBody, /__baddelApplyGameCustomOverride/, 'gdCreatorSave must call window.__baddelApplyGameCustomOverride');
    assert.match(fnBody, /skipSyncedRender.*true|true.*skipSyncedRender/, 'gdCreatorSave must pass skipSyncedRender:true (renderSyncedSuggestions handles re-render)');
});

test('gdCreatorSave: tolerates Game-not-found error from saveMetadata for synced-only games', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'game-details.js'), 'utf8');
    const fnStart = src.indexOf('window.gdCreatorSave = async function');
    assert.ok(fnStart !== -1);
    const fnBody = src.slice(fnStart, fnStart + 25000);
    assert.match(fnBody, /Game not found/, 'gdCreatorSave must handle "Game not found" from saveMetadata without crashing');
});

// ── Metadata sync: __baddelApplyGameCustomOverride defined in artwork-sync.js ─────────

test('artwork-sync.js: __baddelApplyGameCustomOverride patches _suggAllGames, _suggPool, _suggFeaturedGame', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'app', 'artwork-sync.js'), 'utf8');
    const fnStart = src.indexOf('window.__baddelApplyGameCustomOverride');
    assert.ok(fnStart !== -1, '__baddelApplyGameCustomOverride must be defined in artwork-sync.js');
    const fnBody = src.slice(fnStart, fnStart + 6000);
    assert.match(fnBody, /_suggAllGames/, 'must patch _suggAllGames');
    assert.match(fnBody, /_suggPool/, 'must patch _suggPool');
    assert.match(fnBody, /_suggFeaturedGame/, 'must patch _suggFeaturedGame');
    assert.match(fnBody, /_suggArtCacheSet/, 'must call _suggArtCacheSet for matched games');
});

// ── _gdRefreshGameFromDbAfterMutation: broader key matching ─────────────────

test('_gdRefreshGameFromDbAfterMutation: matches on appId, appName, steamAppId, steam_appid', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'game-details.js'), 'utf8');
    const fnStart = src.indexOf('async function _gdRefreshGameFromDbAfterMutation');
    assert.ok(fnStart !== -1, '_gdRefreshGameFromDbAfterMutation must exist');
    const fnBody = src.slice(fnStart, fnStart + 2000);
    assert.match(fnBody, /freshIds/, 'must build a freshIds Set for broad matching');
    assert.match(fnBody, /appId/, 'must check appId in matching');
    assert.match(fnBody, /appName/, 'must check appName in matching');
    assert.match(fnBody, /steamAppId/, 'must check steamAppId in matching');
    assert.match(fnBody, /steam_appid/, 'must check steam_appid in matching');
});

// ── Installed+synced hybrid: _gdCollectCreatorOverrideTargets ────────────────

test('game-details.js: _gdCollectCreatorOverrideTargets is defined and collects synced records', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'game-details.js'), 'utf8');
    const fnStart = src.indexOf('function _gdCollectCreatorOverrideTargets');
    assert.ok(fnStart !== -1, '_gdCollectCreatorOverrideTargets must be defined in game-details.js');
    const fnBody = src.slice(fnStart, fnStart + 4000);
    assert.match(fnBody, /_suggAllGames/, 'must scan _suggAllGames for synced matches');
    assert.match(fnBody, /_suggPool/, 'must scan _suggPool for synced matches');
    assert.match(fnBody, /_suggFeaturedGame/, 'must check _suggFeaturedGame');
    assert.match(fnBody, /allIds/, 'must use allIds for platform-specific ID matching');
    assert.match(fnBody, /steam-/, 'must synthesize steam-prefixed keys for Steam ID matching');
    assert.match(fnBody, /epic-/, 'must synthesize epic-prefixed keys for Epic ID matching');
});

test('gdCreatorSave: uses _gdCollectCreatorOverrideTargets and applies patch to each target', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'game-details.js'), 'utf8');
    const fnStart = src.indexOf('window.gdCreatorSave = async function');
    assert.ok(fnStart !== -1, 'gdCreatorSave must exist');
    const fnBody = src.slice(fnStart, fnStart + 30000);
    assert.match(fnBody, /_gdCollectCreatorOverrideTargets/, 'must call _gdCollectCreatorOverrideTargets');
    assert.match(fnBody, /_gdOverrideTargets\.forEach/, 'must loop over all collected override targets');
    assert.doesNotMatch(fnBody.slice(0, fnBody.indexOf('_gdOverrideTargets.forEach') + 100),
        /window\.__baddelApplyGameCustomOverride\s*\(\s*baseGame\b/,
        'must NOT call __baddelApplyGameCustomOverride with only baseGame (hybrid case requires all targets)');
});

test('artwork-sync.js: __baddelApplyGameCustomOverride updates _suggArtCache for _suggPool and _suggFeaturedGame', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'app', 'artwork-sync.js'), 'utf8');
    const fnStart = src.indexOf('window.__baddelApplyGameCustomOverride');
    assert.ok(fnStart !== -1, '__baddelApplyGameCustomOverride must exist');
    const fnBody = src.slice(fnStart, fnStart + 6000);
    // Must iterate all three sugg sources for art cache updates
    assert.match(fnBody, /_updateSuggArtCache/, 'must use a shared _updateSuggArtCache helper');
    assert.match(fnBody, /\(_suggPool\s*\|\|\s*\[\]\)\.forEach\(_updateSuggArtCache\)|_suggPool.*forEach.*_updateSuggArtCache/,
        'must call _updateSuggArtCache for _suggPool entries');
    assert.match(fnBody, /if\s*\(_suggFeaturedGame\)\s*_updateSuggArtCache/,
        'must call _updateSuggArtCache for _suggFeaturedGame');
});

// ── __baddelApplyGameCustomOverride: full alias fields and pipeline guard ────

test('artwork-sync.js: __baddelApplyGameCustomOverride _applyPatch sets cover and hero alias fields', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'app', 'artwork-sync.js'), 'utf8');
    const fnStart = src.indexOf('window.__baddelApplyGameCustomOverride');
    assert.ok(fnStart !== -1, '__baddelApplyGameCustomOverride must exist');
    const fnBody = src.slice(fnStart, fnStart + 3000);
    assert.match(fnBody, /g\.cover\s*=\s*patch\.cover/, 'must set g.cover (alias used by some platform records)');
    assert.match(fnBody, /g\.hero\s*=\s*patch\.hero/, 'must set g.hero (alias used by some platform records)');
    assert.match(fnBody, /g\.image\s*=\s*patch\.cover/, 'must set g.image from patch.cover');
    assert.match(fnBody, /g\.heroImage\s*=\s*patch\.hero/, 'must set g.heroImage from patch.hero');
});

test('artwork-sync.js: __baddelApplyGameCustomOverride _applyPatch sets pipeline guard flags for cover', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'app', 'artwork-sync.js'), 'utf8');
    const fnStart = src.indexOf('window.__baddelApplyGameCustomOverride');
    assert.ok(fnStart !== -1, '__baddelApplyGameCustomOverride must exist');
    const fnBody = src.slice(fnStart, fnStart + 3000);
    // Pipeline guard flags prevent background metadata pipeline from overwriting creator art
    assert.match(fnBody, /_agCoverPipelineDone\s*=\s*true/, 'must set _agCoverPipelineDone=true to stop pipeline overwrites');
    assert.match(fnBody, /_agCoverInFlight\s*=\s*false/, 'must set _agCoverInFlight=false');
    assert.match(fnBody, /_agLocalRetryCount\s*=\s*999/, 'must set _agLocalRetryCount=999 to prevent re-fetch');
});

// ── gdCreatorSave: unconditional VS re-render ────────────────────────────────

test('gdCreatorSave: calls _vsRender unconditionally (not gated on creatorChangedCount)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'game-details.js'), 'utf8');
    const fnStart = src.indexOf('window.gdCreatorSave = async function');
    assert.ok(fnStart !== -1, 'gdCreatorSave must exist');
    const fnBody = src.slice(fnStart, fnStart + 30000);
    // Must NOT have _vsRender inside a `if (creatorChangedCount > 0)` block
    // Find the render section and verify _vsRender is not nested in that conditional
    const vsRenderIdx = fnBody.indexOf('_vsRender');
    assert.ok(vsRenderIdx !== -1, '_vsRender must be called in gdCreatorSave');
    const contextBefore = fnBody.slice(Math.max(0, vsRenderIdx - 120), vsRenderIdx);
    assert.doesNotMatch(contextBefore, /creatorChangedCount\s*>\s*0/,
        '_vsRender must not be nested inside `if (creatorChangedCount > 0)` — hybrid games with 0 installed matches must still re-render');
});

// ── artwork ownership priority: Settings vs Creator ───────────────────────────

test('saveGameSettings: writes artworkSource settings not creator', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'addGameModal.js'), 'utf8');
    const fnStart = src.indexOf('async function saveGameSettings');
    assert.ok(fnStart !== -1, 'saveGameSettings must exist');
    const fnBody = src.slice(fnStart, fnStart + 8000);
    assert.match(fnBody, /artworkSource\s*[:=]\s*['"]settings['"]/,
        "saveGameSettings must set artworkSource to 'settings', not 'creator'");
    assert.doesNotMatch(fnBody, /artworkSource\s*[:=]\s*['"]creator['"]/,
        "saveGameSettings must not set artworkSource to 'creator' — that would prevent settings from overriding creator art");
});

test('saveGameSettings: includes artworkSource and artworkUpdatedAt in _patch sent to __baddelApplyGameCustomOverride', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'addGameModal.js'), 'utf8');
    const fnStart = src.indexOf('async function saveGameSettings');
    assert.ok(fnStart !== -1, 'saveGameSettings must exist');
    const fnBody = src.slice(fnStart, fnStart + 8000);
    assert.match(fnBody, /_patch\.artworkSource\s*=\s*['"]settings['"]/,
        'saveGameSettings must set _patch.artworkSource = settings before calling __baddelApplyGameCustomOverride');
    assert.match(fnBody, /_patch\.artworkUpdatedAt\s*=\s*_artworkTs/,
        'saveGameSettings must set _patch.artworkUpdatedAt = _artworkTs to carry timestamp into all stores');
});

test('saveGameSettings: calls _gdClearCustomDetailArtwork after image update', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'addGameModal.js'), 'utf8');
    const fnStart = src.indexOf('async function saveGameSettings');
    assert.ok(fnStart !== -1, 'saveGameSettings must exist');
    const fnBody = src.slice(fnStart, fnStart + 8000);
    assert.match(fnBody, /_gdClearCustomDetailArtwork/,
        'saveGameSettings must call _gdClearCustomDetailArtwork to evict stale Creator posterImage');
    // Must pass _changedTypes so only the changed art types are cleared
    assert.match(fnBody, /_gdClearCustomDetailArtwork\s*\([^)]*_changedTypes/,
        'saveGameSettings must pass _changedTypes to _gdClearCustomDetailArtwork');
});

test('saveGameSettings: calls _gdApplyExternalPatch to refresh open Game Detail', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'addGameModal.js'), 'utf8');
    const fnStart = src.indexOf('async function saveGameSettings');
    assert.ok(fnStart !== -1, 'saveGameSettings must exist');
    const fnBody = src.slice(fnStart, fnStart + 8000);
    assert.match(fnBody, /_gdApplyExternalPatch/,
        'saveGameSettings must call _gdApplyExternalPatch so an open Game Detail page reflects the new settings artwork');
});

test('__baddelApplyGameCustomOverride respects patch.artworkSource instead of forcing creator', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'app', 'artwork-sync.js'), 'utf8');
    const fnStart = src.indexOf('window.__baddelApplyGameCustomOverride');
    assert.ok(fnStart !== -1, '__baddelApplyGameCustomOverride must exist');
    const fnBody = src.slice(fnStart, fnStart + 4000);
    // Must NOT unconditionally assign 'creator'
    assert.doesNotMatch(fnBody, /g\.artworkSource\s*=\s*['"]creator['"]/,
        "_applyPatch must not hardcode 'creator' — it must use patch.artworkSource so Settings saves are tagged correctly");
    // Must use patch.artworkSource with fallback
    assert.match(fnBody, /patch\.artworkSource\s*\|\|\s*['"]creator['"]/,
        "_applyPatch must use patch.artworkSource || 'creator' to preserve the caller's intended ownership tag");
});

test('__baddelApplyGameCustomOverride respects patch.artworkUpdatedAt instead of always using now', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'app', 'artwork-sync.js'), 'utf8');
    const fnStart = src.indexOf('window.__baddelApplyGameCustomOverride');
    assert.ok(fnStart !== -1, '__baddelApplyGameCustomOverride must exist');
    const fnBody = src.slice(fnStart, fnStart + 4000);
    assert.match(fnBody, /patch\.artworkUpdatedAt\s*\|\|\s*now/,
        "_applyPatch must use patch.artworkUpdatedAt || now so the shared settings timestamp is preserved");
});

test('game-details.js: _gdClearCustomDetailArtwork exists and nulls posterImage/heroImage/logoImage', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'game-details.js'), 'utf8');
    const fnStart = src.indexOf('window._gdClearCustomDetailArtwork');
    assert.ok(fnStart !== -1, '_gdClearCustomDetailArtwork must be exported on window');
    const fnBody = src.slice(fnStart, fnStart + 1200);
    assert.match(fnBody, /entry\.posterImage\s*=\s*null/,
        '_gdClearCustomDetailArtwork must null posterImage so _gdApplyCustomToGame no longer prefers old creator art');
    assert.match(fnBody, /entry\.coverImage\s*=\s*null/,
        '_gdClearCustomDetailArtwork must null coverImage');
    assert.match(fnBody, /entry\.heroImage\s*=\s*null/,
        '_gdClearCustomDetailArtwork must null heroImage');
    assert.match(fnBody, /entry\.logoImage\s*=\s*null/,
        '_gdClearCustomDetailArtwork must null logoImage');
    assert.match(fnBody, /_gdCreatorSaveStore/,
        '_gdClearCustomDetailArtwork must persist the cleared store back to localStorage');
});

test('game-details.js: _gdClearCustomDetailArtwork only clears requested types when types array supplied', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'game-details.js'), 'utf8');
    const fnStart = src.indexOf('window._gdClearCustomDetailArtwork');
    assert.ok(fnStart !== -1, '_gdClearCustomDetailArtwork must be exported on window');
    const fnBody = src.slice(fnStart, fnStart + 1200);
    // Must guard each field behind a types.includes check
    assert.match(fnBody, /types\.includes\s*\(\s*['"]cover['"]\s*\)/,
        "must guard cover clear behind types.includes('cover')");
    assert.match(fnBody, /types\.includes\s*\(\s*['"]hero['"]\s*\)/,
        "must guard hero clear behind types.includes('hero')");
    assert.match(fnBody, /types\.includes\s*\(\s*['"]logo['"]\s*\)/,
        "must guard logo clear behind types.includes('logo')");
});

test('game-details.js: _gdApplyExternalPatch exists and patches _gdCurrentGame cover aliases', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'game-details.js'), 'utf8');
    const fnStart = src.indexOf('window._gdApplyExternalPatch');
    assert.ok(fnStart !== -1, '_gdApplyExternalPatch must be exported on window');
    const fnBody = src.slice(fnStart, fnStart + 2500);
    assert.match(fnBody, /_gdCurrentGame\.cover\s*=\s*patch\.cover/,
        '_gdApplyExternalPatch must set _gdCurrentGame.cover');
    assert.match(fnBody, /_gdCurrentGame\.image\s*=\s*patch\.cover/,
        '_gdApplyExternalPatch must set _gdCurrentGame.image from patch.cover');
    assert.match(fnBody, /_gdCurrentGame\.heroImage\s*=\s*patch\.hero/,
        '_gdApplyExternalPatch must set _gdCurrentGame.heroImage from patch.hero');
});

test('game-details.js: _gdApplyExternalPatch sets artworkSource and calls _gdPopulateBasic when view visible', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'game-details.js'), 'utf8');
    const fnStart = src.indexOf('window._gdApplyExternalPatch');
    assert.ok(fnStart !== -1, '_gdApplyExternalPatch must be exported on window');
    const fnBody = src.slice(fnStart, fnStart + 2700);
    assert.match(fnBody, /_gdCurrentGame\.artworkSource\s*=\s*patch\.artworkSource/,
        '_gdApplyExternalPatch must propagate artworkSource to _gdCurrentGame');
    assert.match(fnBody, /_gdPopulateBasic\s*\(\s*_gdCurrentGame\s*\)/,
        '_gdApplyExternalPatch must call _gdPopulateBasic(_gdCurrentGame) to re-render the open detail page');
    assert.match(fnBody, /gameDetailsView/,
        '_gdApplyExternalPatch must check gameDetailsView visibility before re-rendering');
});

test('artworkUpdatedAt priority: Settings win described — posterImage nulled so game.image is used', () => {
    // Conceptual contract test: after _gdClearCustomDetailArtwork runs for 'cover',
    // _gdApplyCustomToGame's line `image: custom.posterImage || custom.coverImage || game.image`
    // falls through to game.image (the new settings path) because posterImage and coverImage are null.
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'game-details.js'), 'utf8');
    const fnStart = src.indexOf('function _gdApplyCustomToGame');
    assert.ok(fnStart !== -1, '_gdApplyCustomToGame must exist');
    const fnBody = src.slice(fnStart, fnStart + 700);
    // The fallback chain is the key: posterImage || coverImage || game.image
    assert.match(fnBody, /custom\.posterImage\s*\|\|\s*custom\.coverImage\s*\|\|\s*game\.image/,
        '_gdApplyCustomToGame must have the fallback chain so nulled posterImage falls through to game.image (settings artwork)');
});
