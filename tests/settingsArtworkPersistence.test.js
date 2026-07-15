'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const { JsonGameRepository } = require('../src/features/games/infrastructure/repositories/JsonGameRepository');
const { resolveAllGamesArtwork } = require('../src/features/games/application/services/AllGamesArtworkAdapter');
const { resolveGameDetailsArtwork } = require('../src/features/games/application/services/GameDetailsArtworkAdapter');
const { resolvePlayLauncherArtwork } = require('../src/features/games/application/services/PlayLauncherArtworkAdapter');
const { resolveGameSurfaceArtwork } = require('../src/features/games/application/services/GameSurfaceArtworkAdapter');

function makeRepo(games = []) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-settings-art-'));
    const dbPath = path.join(tmpDir, 'games-db.json');
    fs.writeFileSync(dbPath, JSON.stringify(games), 'utf8');
    const repo = new JsonGameRepository({
        fs,
        path,
        crypto,
        databasePath: dbPath,
        logger: { log: () => {}, error: () => {} },
    });
    return { repo, dbPath };
}

function baseGame(overrides = {}) {
    return { id: 'g1', name: 'Persist Me', command: 'C:\\Games\\Persist.exe', isHidden: false, ...overrides };
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

test('Settings cover persists ownership, lock, timestamp, and aliases across repository restart', async () => {
    const { repo, dbPath } = makeRepo([baseGame({
        coverUrl: 'file://old-cover.webp',
        defaultImage: 'file://old-default.webp',
        posterImage: 'file://creator-poster.webp',
    })]);
    const ts = Date.now() - 500;

    await repo.updateGameImage('g1', 'file://settings-cover.webp', 'cover', {
        source: 'settings',
        locked: true,
        updatedAt: ts,
    });
    await repo.flushDatabase();

    const after = reload(dbPath).getGameById('g1');
    assert.equal(after.customArtworkLocked, true);
    assert.equal(after.artworkSource, 'settings');
    assert.equal(after.artworkUpdatedAt, ts);
    assert.equal(after.image, 'file://settings-cover.webp');
    assert.equal(after.cover, 'file://settings-cover.webp');
    assert.equal(after.coverUrl, 'file://settings-cover.webp');
    assert.equal(after.defaultImage, 'file://settings-cover.webp');
    assert.equal(after.posterImage, 'file://creator-poster.webp');
});

test('Settings hero and logo persist with one operation timestamp and synchronized aliases', async () => {
    const { repo, dbPath } = makeRepo([baseGame({
        background: 'file://old-background.webp',
        logoUrl: 'file://old-logo.webp',
    })]);
    const heroTs = Date.now() - 400;
    const logoTs = Date.now() - 300;

    await repo.updateGameImage('g1', 'file://settings-hero.webp', 'hero', {
        source: 'settings',
        locked: true,
        updatedAt: heroTs,
    });
    await repo.updateGameImage('g1', 'file://settings-logo.webp', 'logo', {
        source: 'settings',
        locked: true,
        updatedAt: logoTs,
    });
    await repo.flushDatabase();

    const after = reload(dbPath).getGameById('g1');
    assert.equal(after.heroImage, 'file://settings-hero.webp');
    assert.equal(after.hero, 'file://settings-hero.webp');
    assert.equal(after.heroUrl, 'file://settings-hero.webp');
    assert.equal(after.defaultHero, 'file://settings-hero.webp');
    assert.equal(after.background, 'file://settings-hero.webp');
    assert.equal(after.logo, 'file://settings-logo.webp');
    assert.equal(after.logoUrl, 'file://settings-logo.webp');
    assert.equal(after.defaultLogo, 'file://settings-logo.webp');
    assert.equal(after.artworkSource, 'settings');
    assert.equal(after.artworkUpdatedAt, logoTs);
});

test('Creator ownership remains available through explicit updateGameImage options', async () => {
    const { repo } = makeRepo([baseGame()]);
    const ts = Date.now() - 200;
    await repo.updateGameImage('g1', 'file://creator-cover.webp', 'cover', {
        source: 'creator',
        locked: true,
        updatedAt: ts,
    });
    const game = repo.getGameById('g1');
    assert.equal(game.artworkSource, 'creator');
    assert.equal(game.artworkUpdatedAt, ts);
    assert.equal(resolveAllGamesArtwork({ game }).value, 'file://creator-cover.webp');
});

test('Settings cover resolves consistently across All Games, Game Details, Play Launcher, and Home surfaces after restart', async () => {
    const { repo, dbPath } = makeRepo([baseGame({
        image: 'file://old-cover.webp',
        heroImage: 'file://home-hero.webp',
        customArtworkLocked: true,
        artworkSource: 'creator',
        artworkUpdatedAt: Date.now() - 1000,
    })]);
    await repo.updateGameImage('g1', 'file://settings-cover.webp', 'cover', {
        source: 'settings',
        locked: true,
        updatedAt: Date.now(),
    });
    await repo.flushDatabase();

    const game = reload(dbPath).getGameById('g1');
    assert.equal(resolveAllGamesArtwork({ game }).value, 'file://settings-cover.webp');
    assert.equal(resolveGameDetailsArtwork({ game }).cover.value, 'file://settings-cover.webp');
    assert.equal(resolvePlayLauncherArtwork({ game }).cover.value, 'file://settings-cover.webp');
    assert.equal(resolveGameSurfaceArtwork({ surface: 'suggestions', game }).cover.value, 'file://settings-cover.webp');
    assert.equal(resolveGameSurfaceArtwork({ surface: 'home-hero', game }).hero.value, 'file://home-hero.webp');
});

test('Metadata hydration cannot overwrite Settings or Creator artwork but can fill missing artwork', async () => {
    const { repo } = makeRepo([
        baseGame({ id: 'settings', image: 'file://settings.webp', customArtworkLocked: true, artworkSource: 'settings' }),
        baseGame({ id: 'creator', image: 'file://creator.webp', customArtworkLocked: true, artworkSource: 'creator' }),
        baseGame({ id: 'missing', image: null, customArtworkLocked: false }),
    ]);

    await repo.updateGameMetadata('settings', { cover: 'file://metadata.webp' }, { source: 'jump-back-in', force: true });
    await repo.updateGameMetadata('creator', { cover: 'file://metadata.webp' }, { source: 'pipeline', force: true });
    await repo.updateGameMetadata('missing', { cover: 'file://metadata.webp' }, { source: 'pipeline', force: true });

    assert.equal(repo.getGameById('settings').image, 'file://settings.webp');
    assert.equal(repo.getGameById('creator').image, 'file://creator.webp');
    assert.equal(repo.getGameById('missing').image, 'file://metadata.webp');
});

test('library-updated merge source keeps authoritative aliases and does not retain stale previous coverUrl', () => {
    const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'app.js'), 'utf8');
    const mergeStart = app.indexOf('function _mergeCanonicalArtworkAcrossLibrary');
    assert.ok(mergeStart !== -1, 'library-updated merge must use the canonical artwork merge helper');
    const mergeBody = app.slice(mergeStart, mergeStart + 3200);
    assert.match(mergeBody, /projectFromRecords/);
    assert.match(mergeBody, /customArtworkLocked/);
    assert.match(mergeBody, /artworkSource/);
    assert.match(mergeBody, /artworkUpdatedAt/);
});
