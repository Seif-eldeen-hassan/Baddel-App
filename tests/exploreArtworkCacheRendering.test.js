'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const APP_JS = fs.readFileSync(path.join(ROOT, 'src', 'js', 'app.js'), 'utf8');
const ARTWORK_SYNC_JS = fs.readFileSync(path.join(ROOT, 'src', 'js', 'app', 'artwork-sync.js'), 'utf8');
const GAME_CARD_JS = fs.readFileSync(path.join(ROOT, 'src', 'js', 'app', 'game-card.js'), 'utf8');
const IMAGE_HANDLERS_JS = fs.readFileSync(path.join(ROOT, 'handlers', 'imageHandlers.js'), 'utf8');

function loadExploreArtworkHelpers({ ImageCtor = undefined } = {}) {
    const start = APP_JS.indexOf('let _artworkRequestSeq = 0;');
    const end = APP_JS.indexOf('async function fetchMetadata', start);
    assert.ok(start >= 0 && end > start, 'Explore artwork helper block found');
    const helperSource = APP_JS.slice(start, end);
    const safeImageUrl = value => {
        const text = String(value || '');
        if (!text) return '';
        if (text.startsWith('file:///C:/Users/test/AppData/Roaming/BaddelLauncher/artwork-cache-v2/')) return text;
        if (text.startsWith('file:///C:/Users/test/AppData/Roaming/BaddelLauncher/image_cache/')) return text;
        if (text.startsWith('data:image/')) return text;
        if (/^https?:\/\//i.test(text)) return text;
        return '';
    };
    return Function('safeImageUrl', 'Image', `${helperSource}
return {
    _isCacheBackedNormalArtworkUrl,
    _beginCardArtworkRequest,
    _applyCardCoverResult,
};`)(safeImageUrl, ImageCtor);
}

function fakeCard(id) {
    const card = {
        dataset: { id },
        isConnected: true,
        querySelector() { return null; },
    };
    const img = {
        src: '',
        dataset: {},
        style: {},
        classList: {
            values: [],
            add(value) { this.values.push(value); },
        },
        closest() { return card; },
    };
    return { card, img };
}

test('Explore artwork helper refuses direct remote normal covers', () => {
    const helpers = loadExploreArtworkHelpers();
    const { card, img } = fakeCard('game-remote');
    const ctx = helpers._beginCardArtworkRequest(img, { id: 'game-remote' });

    const result = helpers._applyCardCoverResult(ctx, 'https://cdn.example/cover.jpg', { source: 'downloaded' });

    assert.equal(result, null);
    assert.equal(img.src, '');
    assert.equal(card.dataset.artworkAssetHash, undefined);
});

test('Explore artwork helper applies only cache-backed cover for the current card token', () => {
    const helpers = loadExploreArtworkHelpers();
    const { card, img } = fakeCard('game-current');
    const ctx = helpers._beginCardArtworkRequest(img, { id: 'game-current' });
    const cover = 'file:///C:/Users/test/AppData/Roaming/BaddelLauncher/artwork-cache-v2/assets/aa/cover.webp';

    const result = helpers._applyCardCoverResult(ctx, cover, { source: 'v2-cache-hit' });

    assert.equal(result, cover);
    assert.equal(img.src, cover);
    assert.equal(img.dataset.lastGoodCover, cover);
    assert.equal(card.dataset.artworkAssetHash, cover);
    assert.deepEqual(img.classList.values, ['img-loaded']);
});

test('Explore artwork helper ignores stale async completions after card reuse', () => {
    const helpers = loadExploreArtworkHelpers();
    const { card, img } = fakeCard('game-before');
    const ctx = helpers._beginCardArtworkRequest(img, { id: 'game-before' });
    card.dataset.id = 'game-after';

    const result = helpers._applyCardCoverResult(
        ctx,
        'file:///C:/Users/test/AppData/Roaming/BaddelLauncher/artwork-cache-v2/assets/bb/cover.webp',
        { source: 'downloaded' }
    );

    assert.equal(result, null);
    assert.equal(img.src, '');
    assert.equal(card.dataset.artworkAssetHash, undefined);
});

test('Explore artwork helper keeps each out-of-order completion on its own card', () => {
    const helpers = loadExploreArtworkHelpers();
    const pairs = Array.from({ length: 6 }, (_, index) => fakeCard(`game-${index}`));
    const contexts = pairs.map(({ img }, index) => helpers._beginCardArtworkRequest(img, { id: `game-${index}` }));
    const covers = pairs.map((_, index) => `file:///C:/Users/test/AppData/Roaming/BaddelLauncher/artwork-cache-v2/assets/${index}/cover.webp`);

    contexts.slice().reverse().forEach((ctx, reverseIndex) => {
        const index = contexts.indexOf(ctx);
        helpers._applyCardCoverResult(ctx, covers[index], { source: `completion-${reverseIndex}` });
    });

    pairs.forEach(({ card, img }, index) => {
        assert.equal(img.src, covers[index]);
        assert.equal(card.dataset.artworkAssetHash, covers[index]);
    });
});

test('Explore artwork helper preserves old cover when replacement preload fails', () => {
    class FailingImage {
        set src(_value) {
            if (typeof this.onerror === 'function') this.onerror(new Error('load failed'));
        }
    }
    const helpers = loadExploreArtworkHelpers({ ImageCtor: FailingImage });
    const { card, img } = fakeCard('game-preload');
    const oldCover = 'file:///C:/Users/test/AppData/Roaming/BaddelLauncher/artwork-cache-v2/assets/old/cover.webp';
    const newCover = 'file:///C:/Users/test/AppData/Roaming/BaddelLauncher/artwork-cache-v2/assets/new/cover.webp';
    img.src = oldCover;
    const ctx = helpers._beginCardArtworkRequest(img, { id: 'game-preload' });

    const result = helpers._applyCardCoverResult(ctx, newCover, { source: 'downloaded' });

    assert.equal(result, newCover);
    assert.equal(img.src, oldCover);
    assert.equal(card.dataset.artworkAssetHash, undefined);
});

test('Explore rendering source contracts prevent transient remote or cross-card cover painting', () => {
    assert.match(APP_JS, /function _isCacheBackedNormalArtworkUrl\s*\(/);
    assert.match(APP_JS, /function _beginCardArtworkRequest\s*\(/);
    assert.match(APP_JS, /function _applyCardCoverResult\s*\(/);
    assert.doesNotMatch(APP_JS, /imgElement\.src\s*=\s*meta\.cover/);
    assert.doesNotMatch(APP_JS, /game\.image\s*=\s*meta\.cover/);
    assert.match(APP_JS, /priority:\s*'visible'/);
    assert.match(APP_JS, /reason:\s*'explore-visible-cover'/);
    assert.match(ARTWORK_SYNC_JS, /document\.querySelectorAll/);
    assert.match(ARTWORK_SYNC_JS, /isCacheBackedArtworkUrl\(cover\)/);
    assert.match(GAME_CARD_JS, /_gcCacheBackedArtworkValue\(displayImg\) \|\| transparentPixel/);
    assert.match(IMAGE_HANDLERS_JS, /return null/);
    assert.doesNotMatch(IMAGE_HANDLERS_JS, /return\s+url\s*;\s*\}\s*catch/);
});
