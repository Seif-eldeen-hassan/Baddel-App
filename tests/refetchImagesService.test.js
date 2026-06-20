'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const os     = require('os');
const path   = require('path');
const fs     = require('fs');

const { refetchMissingImages } = require('../src/features/games/infrastructure/services/RefetchImagesService');

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEngine(games = [], { onBackground, onSave } = {}) {
    let saveCount = 0;
    let bgCalls = [];
    return {
        getStoredGames: () => games,
        backgroundDownload: async (assets, gameId, cb, opts) => {
            bgCalls.push({ assets, gameId, opts, cb });
            if (onBackground) onBackground({ assets, gameId, cb, opts });
        },
        saveDatabase: () => { saveCount++; if (onSave) onSave(); },
        _saveCount: () => saveCount,
        _bgCalls:   () => bgCalls,
    };
}

function makeApi(returnValue = null, { throws = false } = {}) {
    let callCount = 0;
    return {
        lookupGame: async ({ title }) => {
            callCount++;
            if (throws) throw new Error('simulated lookup error');
            return returnValue;
        },
        _callCount: () => callCount,
    };
}

const COVER_META = { images: [{ image_type: 'cover', cdn_url: 'https://cdn.example.com/cover.jpg' }] };

// ── Tests ─────────────────────────────────────────────────────────────────────

test('refetchMissingImages: empty game list — no API calls, no saveDatabase', async () => {
    const engine    = makeEngine([]);
    const baddelApi = makeApi();
    await refetchMissingImages({ engine, baddelApi });
    assert.equal(baddelApi._callCount(), 0, 'no lookup calls expected');
    assert.equal(engine._saveCount(), 0,   'saveDatabase must not be called');
    assert.equal(engine._bgCalls().length, 0, 'no backgroundDownload calls expected');
});

test('refetchMissingImages: game with customArtworkLocked is skipped entirely', async () => {
    const engine    = makeEngine([{ id: 'g1', name: 'Locked Game', image: null, isHidden: false, customArtworkLocked: true }]);
    const baddelApi = makeApi(COVER_META);
    await refetchMissingImages({ engine, baddelApi });
    assert.equal(baddelApi._callCount(), 0);
    assert.equal(engine._bgCalls().length, 0);
    assert.equal(engine._saveCount(), 0);
});

test('refetchMissingImages: hidden game is skipped entirely', async () => {
    const engine    = makeEngine([{ id: 'g1', name: 'Hidden Game', image: null, isHidden: true, customArtworkLocked: false }]);
    const baddelApi = makeApi(COVER_META);
    await refetchMissingImages({ engine, baddelApi });
    assert.equal(baddelApi._callCount(), 0);
    assert.equal(engine._bgCalls().length, 0);
});

test('refetchMissingImages: game with valid local file:// image is not missing', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-refetch-'));
    const imgFile = path.join(dir, 'cover.webp');
    fs.writeFileSync(imgFile, 'x');
    const imgUrl = 'file://' + imgFile.replace(/\\/g, '/');
    try {
        const engine    = makeEngine([{ id: 'g1', name: 'Game', image: imgUrl, isHidden: false, customArtworkLocked: false }]);
        const baddelApi = makeApi(COVER_META);
        await refetchMissingImages({ engine, baddelApi });
        assert.equal(baddelApi._callCount(), 0, 'valid local file must not trigger lookup');
        assert.equal(engine._bgCalls().length, 0);
        assert.equal(engine._saveCount(), 0);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('refetchMissingImages: game with non-file:// CDN URL image is not missing', async () => {
    const engine    = makeEngine([{ id: 'g1', name: 'Game', image: 'https://cdn.example.com/cover.jpg', isHidden: false, customArtworkLocked: false }]);
    const baddelApi = makeApi(COVER_META);
    await refetchMissingImages({ engine, baddelApi });
    assert.equal(baddelApi._callCount(), 0, 'CDN URL image must not trigger lookup');
    assert.equal(engine._saveCount(), 0);
});

test('refetchMissingImages: game with null image triggers lookup', async () => {
    const engine    = makeEngine([{ id: 'g1', name: 'My Game', image: null, isHidden: false, customArtworkLocked: false }]);
    const baddelApi = makeApi(COVER_META);
    await refetchMissingImages({ engine, baddelApi });
    assert.equal(baddelApi._callCount(), 1);
    assert.equal(engine._bgCalls().length, 1);
});

test('refetchMissingImages: missing local file:// path triggers lookup and backgroundDownload', async () => {
    const engine    = makeEngine([{ id: 'g1', name: 'My Game', image: 'file:///nonexistent/no/such/cover.webp', isHidden: false, customArtworkLocked: false }]);
    const baddelApi = makeApi(COVER_META);
    await refetchMissingImages({ engine, baddelApi });
    assert.equal(baddelApi._callCount(), 1);
    const calls = engine._bgCalls();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].assets.cover, 'https://cdn.example.com/cover.jpg');
    assert.equal(calls[0].gameId, 'g1');
    assert.equal(calls[0].opts.source, 'pipeline');
});

test('refetchMissingImages: saveDatabase called exactly once when any download succeeded', async () => {
    const games = [
        { id: 'g1', name: 'Game A', image: null, isHidden: false, customArtworkLocked: false },
        { id: 'g2', name: 'Game B', image: null, isHidden: false, customArtworkLocked: false },
    ];
    const engine    = makeEngine(games);
    const baddelApi = makeApi(COVER_META);
    await refetchMissingImages({ engine, baddelApi });
    assert.equal(engine._saveCount(), 1, 'saveDatabase called exactly once regardless of download count');
    assert.equal(engine._bgCalls().length, 2);
});

test('refetchMissingImages: saveDatabase NOT called when lookup returns null', async () => {
    const engine    = makeEngine([{ id: 'g1', name: 'Game', image: null, isHidden: false, customArtworkLocked: false }]);
    const baddelApi = makeApi(null);
    await refetchMissingImages({ engine, baddelApi });
    assert.equal(engine._saveCount(), 0);
    assert.equal(engine._bgCalls().length, 0);
});

test('refetchMissingImages: lookup with no cover image type — no backgroundDownload, no saveDatabase', async () => {
    const heroOnlyMeta = { images: [{ image_type: 'hero', cdn_url: 'https://cdn.example.com/hero.jpg' }] };
    const engine       = makeEngine([{ id: 'g1', name: 'Game', image: null, isHidden: false, customArtworkLocked: false }]);
    const baddelApi    = makeApi(heroOnlyMeta);
    await refetchMissingImages({ engine, baddelApi });
    assert.equal(engine._bgCalls().length, 0);
    assert.equal(engine._saveCount(), 0);
});

test('refetchMissingImages: lookup error is swallowed — other games continue', async () => {
    const games = [
        { id: 'g1', name: 'Game A', image: null, isHidden: false, customArtworkLocked: false },
        { id: 'g2', name: 'Game B', image: null, isHidden: false, customArtworkLocked: false },
    ];
    let apiCalled = 0;
    const engine    = makeEngine(games);
    const baddelApi = {
        lookupGame: async ({ title }) => {
            apiCalled++;
            if (title === 'Game A') throw new Error('network timeout');
            return COVER_META;
        },
    };
    await refetchMissingImages({ engine, baddelApi });
    assert.equal(apiCalled, 2, 'both games must be attempted');
    assert.equal(engine._bgCalls().length, 1, 'only Game B downloads — Game A error is swallowed');
});

test('refetchMissingImages: notifyCallback is forwarded to backgroundDownload', async () => {
    const engine    = makeEngine([{ id: 'g1', name: 'Game', image: null, isHidden: false, customArtworkLocked: false }]);
    const baddelApi = makeApi(COVER_META);
    const myCallback = () => {};
    await refetchMissingImages({ engine, baddelApi, notifyCallback: myCallback });
    const calls = engine._bgCalls();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].cb, myCallback, 'notifyCallback must be forwarded as-is');
});

test('refetchMissingImages: cdn_url takes precedence over url for cover image', async () => {
    const meta = { images: [{ image_type: 'cover', cdn_url: 'https://cdn.example.com/cdn.jpg', url: 'https://origin.example.com/origin.jpg' }] };
    const engine    = makeEngine([{ id: 'g1', name: 'Game', image: null, isHidden: false, customArtworkLocked: false }]);
    const baddelApi = makeApi(meta);
    await refetchMissingImages({ engine, baddelApi });
    assert.equal(engine._bgCalls()[0].assets.cover, 'https://cdn.example.com/cdn.jpg');
});

test('refetchMissingImages: falls back to url when cdn_url is absent from cover image', async () => {
    const meta = { images: [{ image_type: 'cover', url: 'https://origin.example.com/origin.jpg' }] };
    const engine    = makeEngine([{ id: 'g1', name: 'Game', image: null, isHidden: false, customArtworkLocked: false }]);
    const baddelApi = makeApi(meta);
    await refetchMissingImages({ engine, baddelApi });
    assert.equal(engine._bgCalls()[0].assets.cover, 'https://origin.example.com/origin.jpg');
});
