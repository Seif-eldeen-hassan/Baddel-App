'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildGameArtworkReadModel,
    selectPresentationCandidates,
} = require('../src/features/games/application/services/GameArtworkReadModel');
const { projectFromRecords } = require('../src/features/games/application/services/CanonicalArtworkProjection');

function v2(overrides = {}) {
    return {
        version: 2,
        cover: {
            locked: false,
            overrideValue: null,
            fallbackValue: null,
            revision: 0,
            ...overrides.cover,
        },
        hero: {
            locked: false,
            overrideValue: null,
            fallbackValue: null,
            revision: 0,
            ...overrides.hero,
        },
        logo: {
            locked: false,
            overrideValue: null,
            fallbackValue: null,
            revision: 0,
            ...overrides.logo,
        },
    };
}

test('read model keeps platform cover when canonical V2 cover is empty', () => {
    const model = buildGameArtworkReadModel({
        displayGame: { id: 'steam-1', image: 'platform-cover.jpg' },
        canonicalGame: { id: 'local-1', artworkState: v2() },
    });

    assert.equal(model.cover.effectiveValue, 'platform-cover.jpg');
    assert.equal(model.cover.source, 'display');
});

test('read model keeps platform hero when canonical V2 hero is empty', () => {
    const model = buildGameArtworkReadModel({
        displayGame: { id: 'steam-1', heroImage: 'platform-hero.jpg' },
        canonicalGame: { id: 'local-1', artworkState: v2() },
    });

    assert.equal(model.hero.effectiveValue, 'platform-hero.jpg');
    assert.equal(model.hero.source, 'display');
});

test('read model can use verified metadata logo when canonical and display logo are empty', () => {
    const model = buildGameArtworkReadModel({
        displayGame: { id: 'steam-1' },
        canonicalGame: { id: 'local-1', artworkState: v2() },
        metadataArtwork: { logo: 'metadata-logo.png', verified: true },
    });

    assert.equal(model.logo.effectiveValue, 'metadata-logo.png');
    assert.equal(model.logo.source, 'metadata');
});

test('read model preserves mixed per-type ownership without cross-copying cover and hero', () => {
    const model = buildGameArtworkReadModel({
        displayGame: { id: 'steam-1', heroImage: 'platform-hero.jpg' },
        canonicalGame: {
            id: 'local-1',
            artworkState: v2({
                cover: {
                    locked: true,
                    overrideValue: 'user-cover.webp',
                    overrideSource: 'creator',
                    revision: 7,
                },
            }),
        },
    });

    assert.equal(model.cover.effectiveValue, 'user-cover.webp');
    assert.equal(model.cover.explicit, true);
    assert.equal(model.cover.revision, 7);
    assert.equal(model.hero.effectiveValue, 'platform-hero.jpg');
    assert.notEqual(model.hero.effectiveValue, model.cover.effectiveValue);
});

test('presentation fallback can use cover for Home hero without mutating read model hero', () => {
    const model = buildGameArtworkReadModel({
        displayGame: { id: 'steam-1', image: 'platform-cover.jpg' },
        canonicalGame: { id: 'local-1', artworkState: v2() },
    });

    const homeHeroCandidates = selectPresentationCandidates(model, 'home-hero');
    assert.deepEqual(homeHeroCandidates, ['platform-cover.jpg']);
    assert.equal(model.hero.effectiveValue, null);
});

test('CanonicalArtworkProjection does not erase display cover when canonical cover is empty', () => {
    const projected = projectFromRecords(
        { id: 'steam-1', installedId: 'local-1', image: 'platform-cover.jpg', coverUrl: 'platform-cover.jpg' },
        [{ id: 'local-1', artworkState: v2() }]
    );

    assert.equal(projected.image, 'platform-cover.jpg');
    assert.equal(projected.coverUrl, 'platform-cover.jpg');
    assert.equal(projected.artworkState.version, 2);
});

test('CanonicalArtworkProjection keeps distinct platform hero when canonical cover is explicit', () => {
    const projected = projectFromRecords(
        { id: 'steam-1', installedId: 'local-1', heroImage: 'platform-hero.jpg' },
        [{
            id: 'local-1',
            artworkState: v2({
                cover: {
                    locked: true,
                    overrideValue: 'user-cover.webp',
                    overrideSource: 'settings',
                    revision: 2,
                },
            }),
        }]
    );

    assert.equal(projected.image, 'user-cover.webp');
    assert.equal(projected.heroImage, 'platform-hero.jpg');
});
