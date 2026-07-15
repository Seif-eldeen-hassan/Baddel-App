'use strict';

const assert = require('assert');
const test = require('node:test');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { JsonGameRepository } = require('../src/features/games/infrastructure/repositories/JsonGameRepository');

function makeRepo(games = []) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-art-v2-'));
    const dbPath = path.join(dir, 'games-db.json');
    fs.writeFileSync(dbPath, JSON.stringify(games, null, 2), 'utf8');
    return new JsonGameRepository({ fs, path, crypto, databasePath: dbPath, logger: { log() {}, warn() {}, error() {} } });
}

function game(overrides = {}) {
    return {
        id: 'g1',
        name: 'Test Game',
        command: 'C:/Games/Test/test.exe',
        image: 'file://scanner-cover.webp',
        heroImage: 'file://scanner-hero.webp',
        logo: 'file://scanner-logo.webp',
        ...overrides,
    };
}

test('Artwork State V2: Settings cover survives repeated scanner upserts', async () => {
    const repo = makeRepo([game()]);

    await repo.setGameArtwork('g1', { cover: 'file://settings-cover.webp' }, { source: 'settings' });
    repo.upsertGameRecord(game({ image: 'file://scanner-cover-2.webp', heroImage: 'file://scanner-hero-2.webp' }));
    repo.upsertGameRecord(game({ image: 'file://scanner-cover-3.webp', heroImage: 'file://scanner-hero-3.webp' }));

    const saved = repo.getGameById('g1');
    assert.equal(saved.image, 'file://settings-cover.webp');
    assert.equal(saved.artworkState.cover.overrideSource, 'settings');
    assert.equal(saved.artworkState.cover.fallbackValue, 'file://scanner-cover-3.webp');
});

test('Artwork State V2: Creator background updates hero only and preserves Settings cover', async () => {
    const repo = makeRepo([game()]);

    await repo.setGameArtwork('g1', { cover: 'file://settings-cover.webp' }, { source: 'settings' });
    await repo.updateGameMetadata('g1', { hero: 'file://creator-hero.webp' }, { source: 'creator' });

    const saved = repo.getGameById('g1');
    assert.equal(saved.image, 'file://settings-cover.webp');
    assert.equal(saved.heroImage, 'file://creator-hero.webp');
    assert.equal(saved.artworkState.cover.overrideSource, 'settings');
    assert.equal(saved.artworkState.hero.overrideSource, 'creator');
});

test('Artwork State V2: Creator poster updates cover only and does not replace hero', async () => {
    const repo = makeRepo([game()]);

    await repo.updateGameMetadata('g1', { hero: 'file://creator-hero.webp' }, { source: 'creator' });
    await repo.updateGameMetadata('g1', { cover: 'file://creator-cover.webp' }, { source: 'creator' });

    const saved = repo.getGameById('g1');
    assert.equal(saved.image, 'file://creator-cover.webp');
    assert.equal(saved.heroImage, 'file://creator-hero.webp');
    assert.equal(saved.artworkState.cover.overrideSource, 'creator');
    assert.equal(saved.artworkState.hero.overrideSource, 'creator');
});

test('Artwork State V2: Settings owner rejects lower-priority Creator cover for the same type', async () => {
    const repo = makeRepo([game()]);

    await repo.setGameArtwork('g1', { cover: 'file://settings-cover.webp' }, { source: 'settings' });
    const res = await repo.updateGameMetadata('g1', { cover: 'file://creator-cover.webp' }, { source: 'creator' });

    assert.equal(res.status, 'success');
    const saved = repo.getGameById('g1');
    assert.equal(saved.image, 'file://settings-cover.webp');
    assert.equal(saved.artworkState.cover.overrideSource, 'settings');
});
