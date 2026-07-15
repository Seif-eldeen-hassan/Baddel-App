'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const { JsonGameRepository } = require('../src/features/games/infrastructure/repositories/JsonGameRepository');
const { resolveCanonicalGameIdentity } = require('../src/features/games/application/services/CanonicalGameIdentityResolver');
const { projectFromRecords } = require('../src/features/games/application/services/CanonicalArtworkProjection');

const ROOT = path.join(__dirname, '..');

function makeRepo(games = []) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-durable-art-'));
    const dbPath = path.join(tmpDir, 'games-db.json');
    fs.writeFileSync(dbPath, JSON.stringify(games, null, 2), 'utf8');
    return {
        repo: new JsonGameRepository({
            fs,
            path,
            crypto,
            databasePath: dbPath,
            logger: { log: () => {}, error: () => {} },
        }),
        dbPath,
    };
}

function reload(dbPath) {
    return new JsonGameRepository({
        fs,
        path,
        crypto,
        databasePath: dbPath,
        logger: { log: () => {}, error: () => {} },
    });
}

function localCs2(overrides = {}) {
    return {
        id: 'local-cs2',
        name: 'Counter-Strike 2',
        installedGameKey: 'steam:730:C:/Games/Steam/steamapps/common/Counter-Strike Global Offensive/game/bin/win64/cs2.exe',
        command: 'C:\\Games\\Steam\\steamapps\\common\\Counter-Strike Global Offensive\\game\\bin\\win64\\cs2.exe',
        executablePath: 'C:\\Games\\Steam\\steamapps\\common\\Counter-Strike Global Offensive\\game\\bin\\win64\\cs2.exe',
        allIds: { steam: '730' },
        platform: 'steam',
        ...overrides,
    };
}

function syncedCs2(overrides = {}) {
    return {
        id: 'steam-730',
        installedId: 'local-cs2',
        name: 'Counter-Strike 2',
        allIds: { steam: '730' },
        platform: 'steam',
        ...overrides,
    };
}

test('CanonicalGameIdentityResolver resolves synced UI id to local DB id by installedId', () => {
    const result = resolveCanonicalGameIdentity(syncedCs2(), [localCs2()]);
    assert.equal(result.status, 'success');
    assert.equal(result.id, 'local-cs2');
    assert.equal(result.reason, 'installedId');
});

test('CanonicalGameIdentityResolver resolves localGameId before platform ids', () => {
    const result = resolveCanonicalGameIdentity({ id: 'steam-730', localGameId: 'local-cs2', allIds: { steam: '999' } }, [
        localCs2(),
        localCs2({ id: 'wrong', allIds: { steam: '999' } }),
    ]);
    assert.equal(result.id, 'local-cs2');
    assert.equal(result.reason, 'localGameId');
});

test('CanonicalGameIdentityResolver resolves exact existing local DB id', () => {
    const result = resolveCanonicalGameIdentity({ id: 'local-cs2' }, [localCs2()]);
    assert.equal(result.id, 'local-cs2');
    assert.equal(result.reason, 'id');
});

test('CanonicalGameIdentityResolver resolves installedGameKey', () => {
    const key = localCs2().installedGameKey;
    const result = resolveCanonicalGameIdentity({ id: 'steam-730', installedGameKey: key }, [localCs2()]);
    assert.equal(result.id, 'local-cs2');
    assert.equal(result.reason, 'installedGameKey');
});

test('CanonicalGameIdentityResolver resolves normalized executable path', () => {
    const result = resolveCanonicalGameIdentity({ id: 'steam-730', command: 'file://c:/games/steam/steamapps/common/counter-strike global offensive/game/bin/win64/cs2.exe' }, [localCs2()]);
    assert.equal(result.id, 'local-cs2');
    assert.equal(result.reason, 'command');
});

test('CanonicalGameIdentityResolver resolves verified Steam app id mapping', () => {
    const result = resolveCanonicalGameIdentity({ id: 'steam-730', allIds: { steam: '730' } }, [localCs2()]);
    assert.equal(result.id, 'local-cs2');
    assert.equal(result.reason, 'steam');
});

test('CanonicalGameIdentityResolver resolves verified Epic appName and namespace tuple', () => {
    const result = resolveCanonicalGameIdentity(
        { id: 'epic-alan-wake-2', appName: 'AlanWake2', namespace: 'o-abc' },
        [{ id: 'local-aw2', appName: 'AlanWake2', namespace: 'o-abc' }]
    );
    assert.equal(result.id, 'local-aw2');
    assert.equal(result.reason, 'epic');
});

test('CanonicalGameIdentityResolver does not persist by title-only collision', () => {
    const result = resolveCanonicalGameIdentity({ id: 'steam-730', name: 'Counter-Strike 2' }, [localCs2()]);
    assert.equal(result.status, 'error');
    assert.equal(result.reason, 'not-found');
});

test('JsonGameRepository persists Settings cover to canonical local id before returning success', async () => {
    const { repo, dbPath } = makeRepo([localCs2({ image: 'file://old.webp' })]);
    const result = await repo.updateGameImage(syncedCs2(), 'C:\\Art\\cs2-cover.webp', 'cover', {
        source: 'settings',
        locked: true,
        updatedAt: 12345,
    });

    assert.equal(result.status, 'success');
    assert.equal(result.requestedGameId, 'steam-730');
    assert.equal(result.canonicalGameId, 'local-cs2');
    assert.equal(result.persisted, true);
    assert.equal(result.updatedGame.image, 'file://C:\\Art\\cs2-cover.webp');

    const after = reload(dbPath).getGameById('local-cs2');
    assert.equal(after.image, 'file://C:\\Art\\cs2-cover.webp');
    assert.equal(after.coverUrl, 'file://C:\\Art\\cs2-cover.webp');
    assert.equal(after.customArtworkLocked, true);
    assert.equal(after.artworkSource, 'settings');
    assert.equal(after.artworkUpdatedAt, 12345);
});

test('JsonGameRepository returns error and no false success when canonical local record is missing', async () => {
    const { repo } = makeRepo([]);
    const result = await repo.updateGameImage(syncedCs2(), 'file://cover.webp', 'cover');
    assert.equal(result.status, 'error');
    assert.equal(result.message, 'Game not found');
    assert.equal(result.requestedGameId, 'steam-730');
    assert.equal(result.canonicalGameId, null);
    assert.equal(result.persisted, false);
});

test('JsonGameRepository returns error when durable flush fails', async () => {
    const { repo } = makeRepo([localCs2()]);
    repo.flushDatabase = async () => { throw new Error('disk full'); };
    const result = await repo.updateGameImage(syncedCs2(), 'file://cover.webp', 'cover');
    assert.equal(result.status, 'error');
    assert.equal(result.canonicalGameId, 'local-cs2');
    assert.equal(result.persisted, false);
});

test('CanonicalArtworkProjection maps Settings-owned local art onto synced display object after restart', () => {
    const projected = projectFromRecords(syncedCs2({ image: 'https://cdn.example/old.jpg' }), [
        localCs2({
            image: 'file://settings-cover.webp',
            coverUrl: 'file://settings-cover.webp',
            heroImage: 'file://settings-hero.webp',
            logo: 'file://settings-logo.webp',
            customArtworkLocked: true,
            artworkSource: 'settings',
            artworkUpdatedAt: 999,
        }),
    ]);
    assert.equal(projected.id, 'steam-730');
    assert.equal(projected.localGameId, 'local-cs2');
    assert.equal(projected.image, 'file://settings-cover.webp');
    assert.equal(projected.heroImage, 'file://settings-hero.webp');
    assert.equal(projected.logo, 'file://settings-logo.webp');
    assert.equal(projected.artworkSource, 'settings');
    assert.equal(projected.artworkUpdatedAt, 999);
});

test('Renderer Settings save validates persisted backend result before local artwork state mutation or success toast', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'js', 'addGameModal.js'), 'utf8');
    const start = src.indexOf('async function saveGameSettings');
    const body = src.slice(start, start + 14000);
    const failureIdx = body.indexOf("res.status !== 'success'");
    const storageIdx = body.indexOf('localStorage.removeItem');
    const successIdx = body.indexOf("showToast('Settings saved successfully!'");
    assert.ok(body.includes('_gsBuildArtworkIdentity(g, selectedGameId)'));
    assert.ok(body.includes('res.persisted !== true'));
    assert.ok(body.includes('setGameArtwork'));
    assert.ok(failureIdx !== -1 && storageIdx !== -1 && failureIdx < storageIdx);
    assert.ok(storageIdx !== -1 && successIdx !== -1 && storageIdx < successIdx);
});

test('Jump Back In canonicalizes recent games before resolving display image', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'js', 'app', 'game-card.js'), 'utf8');
    assert.match(src, /function _canonicalizeRecentGame/);
    assert.match(src, /function createRecentCard\(game, isFeatured = false\)[\s\S]*_canonicalizeRecentGame\(game\)/);
    assert.match(src, /function createRecentCard\(game, isFeatured = false\)[\s\S]*_getRecentDisplayImage\(game\)/);
});

test('Game Settings preview projects canonical artwork before reading image fields', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'js', 'addGameModal.js'), 'utf8');
    const start = src.indexOf('function openGameSettings');
    const body = src.slice(start, start + 1800);
    assert.match(body, /BaddelCanonicalArtworkProjection/);
    assert.match(body, /projectFromRecords\(g,\s*records\)/);
    assert.match(body, /window\._allGamesCache/);
});

test('Creator Mode saved game carries cover, hero, logo aliases and creator ownership', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'js', 'game-details.js'), 'utf8');
    const start = src.indexOf('function _gdApplyCustomToGame');
    const body = src.slice(start, start + 1800);
    assert.match(body, /coverUrl:\s*effectiveCover/);
    assert.match(body, /defaultImage:\s*effectiveCover/);
    assert.match(body, /heroUrl:\s*effectiveHero/);
    assert.match(body, /defaultHero:\s*effectiveHero/);
    assert.match(body, /customArtworkLocked:\s*hasCreatorArtwork \? true/);
    assert.match(body, /artworkSource:\s*hasCreatorArtwork \? 'creator'/);
});

test('Creator save patch propagates artworkSource and canonical refresh id', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'js', 'game-details.js'), 'utf8');
    const start = src.indexOf('window.gdCreatorSave = async function');
    const body = src.slice(start, start + 12000);
    assert.match(body, /creatorArtworkUpdatedAt/);
    assert.match(body, /artworkSource:\s*'creator'/);
    assert.match(body, /artworkUpdatedAt:\s*creatorArtworkUpdatedAt/);
    assert.match(body, /const res = await window\.electronAPI\.saveMetadata/);
    assert.match(body, /res\?\.canonicalGameId \|\| gameId/);
});

test('All Games cached cover hydration skips Settings and Creator locked artwork', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'js', 'accounts.js'), 'utf8');
    const start = src.indexOf('async function _agHydrateCachedCoversIntoAllGames');
    const body = src.slice(start, start + 3800);
    assert.match(body, /customArtworkLocked === true/);
    assert.match(body, /artworkSource === 'settings'/);
    assert.match(body, /artworkSource === 'creator'/);
});
