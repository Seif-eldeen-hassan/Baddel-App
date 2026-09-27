'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const ReadModel = require('../src/features/games/application/services/GameArtworkReadModel');
const Details = require('../src/features/games/application/services/GameDetailsArtworkAdapter');
const Surface = require('../src/features/games/application/services/GameSurfaceArtworkAdapter');
const Presentation = require('../src/features/games/application/services/HomeArtworkPresentation');
const ArtworkState = require('../src/features/games/domain/services/GameArtworkState');
const { ContentAddressedArtworkCache } = require('../src/features/games/infrastructure/services/ContentAddressedArtworkCache');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lWv2YQAAAABJRU5ErkJggg==', 'base64');
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64');

function state(values = {}, availability = {}) {
    return {
        version: 2,
        ...Object.fromEntries(['cover', 'hero', 'logo'].map(type => [type, {
            locked: false, overrideValue: null, overrideSource: null,
            fallbackValue: values[type] || null, fallbackSource: values[type] ? 'metadata' : null,
            revision: values[type] ? 1 : 0,
            availability: availability[type] || (values[type] ? 'available' : 'terminal-miss'),
        }])),
    };
}

function model(game, options = {}) {
    return ReadModel.buildGameArtworkReadModel({ displayGame: game, canonicalGame: game, ...options });
}

test('Sanitarium-style distinct Cover and Hero remain typed across card and Home', () => {
    const game = { id: 'gog-install-1', platform: 'gog', productId: '100', artworkState: state({ cover: 'cover.webp', hero: 'eye-hero.webp' }) };
    const read = model(game);
    assert.equal(Presentation.selectCardArtwork(read).value, 'cover.webp');
    assert.equal(Presentation.selectHomeHeroArtwork(read).background, 'eye-hero.webp');
    assert.notEqual(read.cover.effectiveValue, read.hero.effectiveValue);
});

test('Home and Game Details resolve identical typed effective values', () => {
    const game = { id: 'epic-install-1', platform: 'epic', appName: 'Detroit', artworkState: state({ cover: 'cover.webp', hero: 'hero.webp', logo: 'logo.png' }) };
    const home = Surface.resolveGameSurfaceArtwork({ surface: 'home', game });
    const details = Details.resolveGameDetailsArtwork({ game });
    for (const type of ['cover', 'hero', 'logo']) assert.equal(home[type].value, details[type].value);
});

test('metadata-only Hero stays pending until a typed cache representation arrives', () => {
    const game = { id: 'riot-1', platform: 'riot', riotProduct: 'valorant' };
    const pending = model(game, { metadataArtwork: { hero: 'https://cdn.example/hero.jpg', verified: true } });
    assert.equal(pending.hero.pending, true);
    assert.equal(pending.hero.effectiveValue, null);
    assert.equal(Presentation.selectHomeHeroArtwork(pending, { previousHero: 'stable.webp' }).background, 'stable.webp');
    const ready = model(game, {
        metadataArtwork: { hero: 'https://cdn.example/hero.jpg', verified: true },
        cacheArtwork: { hero: { value: 'file://cache/hero.webp', representsSource: 'metadata' } },
    });
    assert.equal(ready.hero.effectiveValue, 'file://cache/hero.webp');
    assert.equal(Presentation.selectHomeHeroArtwork(ready).background, 'file://cache/hero.webp');
});

test('metadata-only Logo replaces text fallback after its independent commit', () => {
    const game = { id: 'riot-1', platform: 'riot', riotProduct: 'valorant' };
    const pending = model(game, { metadataArtwork: { logo: 'https://cdn.example/logo.png', verified: true } });
    assert.equal(Presentation.selectHomeHeroArtwork(pending).logo, null);
    const ready = model({ ...game, artworkState: state({ logo: 'file://cache/logo.png' }) });
    assert.equal(Presentation.selectHomeHeroArtwork(ready).logo, 'file://cache/logo.png');
});

test('a Game Details artwork commit is immediately reusable by Home without restart', () => {
    const before = { id: 'g1', platform: 'steam', appId: '10', artworkState: state({ cover: 'cover.webp' }, { hero: 'pending', logo: 'pending' }) };
    assert.equal(Presentation.selectHomeHeroArtwork(model(before)).background, null);
    const committed = { ...before, artworkState: state({ cover: 'cover.webp', hero: 'hero.webp', logo: 'logo.png' }) };
    const after = Presentation.selectHomeHeroArtwork(model(committed));
    assert.equal(after.background, 'hero.webp');
    assert.equal(after.logo, 'logo.png');
});

test('typed Cover, Hero and Logo restore after cache recreation', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-art-lifecycle-'));
    try {
        const make = () => new ContentAddressedArtworkCache({ fs, path, crypto, baseDir: path.join(root, 'cache'), logger: { log() {}, warn() {}, error() {} } });
        const cache = make();
        cache.storeBuffer({ canonicalGameId: 'steam:all:10', type: 'cover', buffer: PNG, mime: 'image/png' });
        cache.storeBuffer({ canonicalGameId: 'steam:all:10', type: 'hero', buffer: GIF, mime: 'image/gif' });
        cache.storeBuffer({ canonicalGameId: 'steam:all:10', type: 'logo', buffer: PNG, mime: 'image/png' });
        const restarted = make();
        for (const type of ['cover', 'hero', 'logo']) assert.ok(restarted.lookupAlias({ canonicalGameId: 'steam:all:10', type }));
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('library card is Cover-only even when Hero and Logo exist', () => {
    const read = model({ id: 'g1', artworkState: state({ cover: 'cover.webp', hero: 'hero.webp', logo: 'logo.png' }) });
    assert.deepEqual(ReadModel.selectPresentationCandidates(read, 'library-card'), ['cover.webp']);
});

test('Cover fallback is allowed only after terminal Hero miss and never populates canonical Hero', () => {
    const pendingGame = { id: 'g1', artworkState: state({ cover: 'cover.webp' }, { hero: 'pending' }), __baddelArtworkAvailability: { hero: { state: 'pending' } } };
    assert.equal(Presentation.selectHomeHeroArtwork(model(pendingGame)).background, null);
    const terminalGame = { id: 'g1', artworkState: state({ cover: 'cover.webp' }, { hero: 'terminal-miss' }), __baddelArtworkAvailability: { hero: { state: 'terminal-miss' } } };
    const read = model(terminalGame);
    assert.equal(Presentation.selectHomeHeroArtwork(read).background, 'cover.webp');
    assert.equal(read.hero.effectiveValue, null);
});

test('confirmed no-Logo state selects text fallback without a pending retry state', () => {
    const read = model({ id: 'g1', artworkState: state({}, { logo: 'terminal-miss' }), __baddelArtworkAvailability: { logo: { state: 'terminal-miss' } } });
    const selected = Presentation.selectHomeHeroArtwork(read);
    assert.equal(selected.logo, null);
    assert.equal(selected.logoPending, false);
    assert.equal(selected.logoSource, 'text-terminal-fallback');
});

test('a Cover lookup can never return a Hero-only logical cache mapping', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-art-types-'));
    try {
        const cache = new ContentAddressedArtworkCache({ fs, path, crypto, baseDir: path.join(root, 'cache'), logger: { log() {}, warn() {}, error() {} } });
        const stored = cache.storeBuffer({ canonicalGameId: 'g1', type: 'hero', buffer: PNG, mime: 'image/png' });
        assert.equal(cache.lookupAlias({ canonicalGameId: 'g1', type: 'cover' }), null);
        assert.equal(cache.lookupFileUrl(stored.fileUrl, { type: 'cover' }), null);
        assert.ok(cache.lookupFileUrl(stored.fileUrl, { type: 'hero' }));
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('startup migration invalidates a mismatched typed alias idempotently', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-art-migrate-'));
    try {
        const baseDir = path.join(root, 'cache');
        let cache = new ContentAddressedArtworkCache({ fs, path, crypto, baseDir, logger: { log() {}, warn() {}, error() {} } });
        const stored = cache.storeBuffer({ canonicalGameId: 'g1', type: 'hero', buffer: PNG, mime: 'image/png' });
        const manifestPath = path.join(baseDir, 'manifest.json');
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        manifest.aliases['g1:cover'] = { canonicalGameId: 'g1', type: 'hero', assetHash: stored.assetHash };
        manifest.assets[stored.assetHash].aliases.push('g1:cover');
        fs.writeFileSync(manifestPath, JSON.stringify(manifest));
        cache = new ContentAddressedArtworkCache({ fs, path, crypto, baseDir, logger: { log() {}, warn() {}, error() {} } });
        assert.equal(cache.lookupAlias({ canonicalGameId: 'g1', type: 'cover' }), null);
        assert.ok(cache.lookupAlias({ canonicalGameId: 'g1', type: 'hero' }));
        const once = cache.getManifest();
        cache = new ContentAddressedArtworkCache({ fs, path, crypto, baseDir, logger: { log() {}, warn() {}, error() {} } });
        assert.deepEqual(cache.getManifest().aliases, once.aliases);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('automatic GOG scanner art is not promoted into canonical Logo', () => {
    const game = {
        id: 'gog_100', platform: 'gog', productId: '100', logo: 'file://scanner-icon.webp',
        artworkState: state({ cover: 'cover.webp' }),
    };
    game.artworkState.logo = { ...game.artworkState.logo, fallbackValue: game.logo, fallbackSource: 'scanner', availability: 'available' };
    const read = model(game);
    assert.equal(read.logo.effectiveValue, null);
    assert.equal(Presentation.selectHomeHeroArtwork(read).logo, null);
    assert.equal(Details.resolveGameDetailsArtwork({ game }).logo.value, null);
});

test('merged provider identities remain strong and never deduplicate by title', () => {
    const a = { id: 'local-a', title: 'Same', platform: 'gog', allIds: { steam: '10', epic: 'epic-a', gog: '100', riot: 'riot-a' }, productId: '100' };
    const b = { id: 'local-b', title: 'Same', platform: 'gog', allIds: { steam: '20', epic: 'epic-b', gog: '200', riot: 'riot-b' }, productId: '200' };
    const aKeys = new Set(ReadModel.resolveArtworkCacheKeys(a, a));
    const bKeys = new Set(ReadModel.resolveArtworkCacheKeys(b, b));
    assert.equal([...aKeys].some(key => String(key).startsWith('title:')), false);
    assert.equal([...aKeys].some(key => bKeys.has(key)), false);
});

test('rapid hover guard rejects stale decoded Hero and Logo results', () => {
    const guard = Presentation.createAtomicArtworkCommitGuard();
    const first = guard.begin('game-a');
    const second = guard.begin('game-b');
    assert.equal(guard.accepts(first, true), false);
    assert.equal(guard.accepts(second, true), true);
});

test('custom artwork locks remain per-type and automatic writes cannot replace them', () => {
    let artwork = ArtworkState.createArtworkState();
    artwork = ArtworkState.applyExplicitOverride(artwork, 'cover', 'user-cover.webp', { source: 'settings' }).state;
    const coverWrite = ArtworkState.applyFallback(artwork, 'cover', 'automatic-cover.webp', { source: 'metadata' });
    const heroWrite = ArtworkState.applyFallback(artwork, 'hero', 'automatic-hero.webp', { source: 'metadata' });
    assert.equal(coverWrite.applied, true);
    assert.equal(ArtworkState.getEffectiveArtwork(coverWrite.state, 'cover'), 'user-cover.webp');
    assert.equal(heroWrite.applied, true);
    assert.equal(ArtworkState.getEffectiveArtwork(heroWrite.state, 'hero'), 'automatic-hero.webp');
});

test('failed download/decode retains previous stable artwork', () => {
    const pending = model({ id: 'g1', __baddelArtworkAvailability: { hero: { state: 'pending' }, logo: { state: 'pending' } } });
    const selected = Presentation.selectHomeHeroArtwork(pending, { previousHero: 'stable-hero.webp', previousLogo: 'stable-logo.png' });
    assert.equal(selected.background, 'stable-hero.webp');
    assert.equal(selected.logo, 'stable-logo.png');
});

test('visible Explore artwork work stays bounded to visible and near-visible games', () => {
    const games = Array.from({ length: 1003 }, (_, id) => ({ id }));
    assert.equal(Presentation.visibleArtworkWork(games, { visibleLimit: 15, nearVisible: 3 }).length, 18);
});
