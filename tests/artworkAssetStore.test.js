'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { fileURLToPath } = require('url');

const { ArtworkAssetStore } = require('../src/features/games/infrastructure/services/ArtworkAssetStore');
const { JsonGameRepository } = require('../src/features/games/infrastructure/repositories/JsonGameRepository');

function tempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-artwork-store-'));
}

function silentLogger() {
    return { log() {}, warn() {}, error() {} };
}

const PNG_1X1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lWv2YQAAAABJRU5ErkJggg==';

test('ArtworkAssetStore materializes data:image artwork into canonical user_artwork files', () => {
    const root = tempDir();
    const store = new ArtworkAssetStore({
        fs,
        path,
        crypto,
        baseDir: path.join(root, 'user_artwork'),
        logger: silentLogger(),
    });

    const url = store.materializeSync({
        canonicalGameId: 'local:cs2',
        type: 'cover',
        value: PNG_1X1,
    });

    assert.match(url, /^file:\/\//);
    assert.equal(store.ownsUrl(url), true);
    assert.equal(fs.existsSync(fileURLToPath(url)), true);
    assert.match(fileURLToPath(url), /user_artwork/);
    assert.doesNotMatch(url, /data:image/);
});

test('JsonGameRepository setGameArtwork stores explicit Creator data URLs as trusted file URLs', async () => {
    const root = tempDir();
    const dbPath = path.join(root, 'games-db.json');
    fs.writeFileSync(dbPath, JSON.stringify([{ id: 'game-1', name: 'Game One' }]), 'utf8');
    const store = new ArtworkAssetStore({
        fs,
        path,
        crypto,
        baseDir: path.join(root, 'user_artwork'),
        logger: silentLogger(),
    });
    const repo = new JsonGameRepository({
        fs,
        path,
        crypto,
        databasePath: dbPath,
        logger: silentLogger(),
        artworkAssetStore: store,
    });

    const result = await repo.setGameArtwork('game-1', { cover: PNG_1X1 }, { source: 'creator' });

    assert.equal(result.status, 'success');
    assert.equal(result.updatedGame.artworkState.cover.locked, true);
    assert.equal(store.ownsUrl(result.updatedGame.artworkState.cover.overrideValue), true);
    assert.equal(result.updatedGame.image, result.updatedGame.artworkState.cover.overrideValue);
    assert.doesNotMatch(result.updatedGame.image, /data:image/);
});

test('JsonGameRepository migrates legacy file://data:image explicit overrides to user_artwork', () => {
    const root = tempDir();
    const dbPath = path.join(root, 'games-db.json');
    fs.writeFileSync(dbPath, JSON.stringify([{
        id: 'game-1',
        name: 'Game One',
        artworkState: {
            version: 2,
            cover: {
                locked: true,
                overrideValue: `file://${PNG_1X1}`,
                overrideSource: 'creator',
                revision: 1,
            },
        },
    }]), 'utf8');
    const store = new ArtworkAssetStore({
        fs,
        path,
        crypto,
        baseDir: path.join(root, 'user_artwork'),
        logger: silentLogger(),
    });

    const repo = new JsonGameRepository({
        fs,
        path,
        crypto,
        databasePath: dbPath,
        logger: silentLogger(),
        artworkAssetStore: store,
    });

    const game = repo.getGameById('game-1');
    assert.equal(store.ownsUrl(game.artworkState.cover.overrideValue), true);
    assert.doesNotMatch(game.artworkState.cover.overrideValue, /data:image/);
    assert.equal(game.image, game.artworkState.cover.overrideValue);
});

test('JsonGameRepository rejects transient blob artwork without reporting persisted success', async () => {
    const root = tempDir();
    const dbPath = path.join(root, 'games-db.json');
    fs.writeFileSync(dbPath, JSON.stringify([{ id: 'game-1', name: 'Game One' }]), 'utf8');
    const repo = new JsonGameRepository({
        fs,
        path,
        crypto,
        databasePath: dbPath,
        logger: silentLogger(),
        artworkAssetStore: new ArtworkAssetStore({
            fs,
            path,
            crypto,
            baseDir: path.join(root, 'user_artwork'),
            logger: silentLogger(),
        }),
    });

    const result = await repo.setGameArtwork('game-1', { hero: 'blob:http://local/image' }, { source: 'settings' });

    assert.equal(result.status, 'error');
    assert.equal(result.persisted, false);
    assert.equal(repo.getGameById('game-1').artworkState.hero.locked, false);
});
