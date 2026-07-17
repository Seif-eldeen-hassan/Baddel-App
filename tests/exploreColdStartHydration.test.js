'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const APP_JS = fs.readFileSync(path.join(ROOT, 'src/js/app.js'), 'utf8');

function controllerSource() {
    const start = APP_JS.indexOf('function _dispatchHomeVisibleWhenReady');
    const end = APP_JS.indexOf('function _explorePatchCardArtwork');
    assert.ok(start >= 0 && end > start, 'Explore hydration controller block exists');
    return APP_JS.slice(start, end);
}

function makeCard(id) {
    const assignments = [];
    const img = {
        dataset: {},
        style: {},
        classList: { add() {}, remove() {} },
    };
    let src = '';
    Object.defineProperty(img, 'src', {
        get() { return src; },
        set(value) {
            src = value;
            assignments.push(value);
        },
    });
    return {
        isConnected: true,
        dataset: { id, artworkSurface: 'explore' },
        assignments,
        img,
        querySelector(selector) {
            return selector === '.actual-img' ? img : null;
        },
    };
}

function makeSandbox({ count = 15, concurrency = 3, cacheHits = 2, special = {} } = {}) {
    const cards = new Map();
    const listeners = new Map();
    const calls = {
        getMetadata: [],
        cacheAllAssets: [],
        saveMetadata: [],
        patches: [],
        raf: 0,
        renders: 0,
        navigations: 0,
    };
    const games = Array.from({ length: count }, (_, index) => ({
        id: `display-${index}`,
        localGameId: `canonical-${index}`,
        name: `Game ${index}`,
        image: null,
    }));
    const sandbox = {
        window: {},
        document: {
            querySelector(selector) {
                const match = String(selector).match(/^\[data-id="(.+)"\]$/);
                return match ? cards.get(match[1]) || null : null;
            },
        },
        CSS: { escape(value) { return String(value).replace(/"/g, '\\"'); } },
        CustomEvent: class CustomEvent {
            constructor(type, init = {}) {
                this.type = type;
                this.detail = init.detail || {};
            }
        },
        requestAnimationFrame(callback) {
            calls.raf += 1;
            return setTimeout(callback, 0);
        },
        setTimeout,
        clearTimeout,
        Promise,
        Map,
        Set,
        Number,
        String,
        Object,
        Date,
        console: { info() {}, warn() {}, debug() {}, error() {}, log() {} },
        localStorage: {
            getItem(key) {
                const match = String(key).match(/^cover_display-(\d+)$/);
                if (match && Number(match[1]) < cacheHits) return `file://legacy-${match[1]}.webp`;
                return null;
            },
        },
        _isCacheBackedNormalArtworkUrl(value) {
            return String(value || '').startsWith('file://') ? value : null;
        },
    };
    sandbox.window = sandbox;
    sandbox.window.__baddelExploreHydrationConcurrency = concurrency;
    sandbox.window.addEventListener = (type, handler) => {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(handler);
    };
    sandbox.window.dispatchEvent = event => {
        for (const handler of listeners.get(event.type) || []) handler(event);
    };
    sandbox.window.BaddelGameArtworkReadModel = {
        resolveArtworkCacheKeys(displayGame, canonicalGame) {
            return [canonicalGame?.id, displayGame?.localGameId, displayGame?.id].filter(Boolean);
        },
        createReadModel(game) {
            return { cover: { effectiveValue: game?.image || null } };
        },
    };
    sandbox.window.electronAPI = {
        async getCachedImage(key, type) {
            assert.ok(['cover', 'hero', 'logo'].includes(type));
            const index = Number(String(key).replace(/\D+/g, ''));
            if (type === 'cover' && Number.isFinite(index) && index < cacheHits && String(key).startsWith('canonical-')) {
                return `file://cached-${index}.webp`;
            }
            return null;
        },
        async getMetadata(name, payload) {
            calls.getMetadata.push({ name, payload });
            if (special.noCover?.has(payload.id)) return {};
            return {
                cover: `https://cdn/${payload.id}.jpg`,
                hero: `https://cdn/${payload.id}-hero.jpg`,
                logo: `https://cdn/${payload.id}-logo.png`,
            };
        },
        async cacheAllAssets(assets, canonicalGameId, opts) {
            calls.cacheAllAssets.push({ assets, canonicalGameId, opts, active: sandbox.window.__activeDownloads });
            assert.deepEqual(Object.keys(assets), ['cover', 'hero', 'logo']);
            if (special.fail?.has(canonicalGameId)) throw new Error('download failed');
            if (special.block?.has(canonicalGameId)) return {};
            return new Promise(resolve => {
                setTimeout(() => resolve({
                    cover: `file://${canonicalGameId}.webp`,
                    hero: `file://${canonicalGameId}-hero.webp`,
                    logo: `file://${canonicalGameId}-logo.webp`,
                }), special.delay || 0);
            });
        },
        async saveMetadata(canonicalGameId, meta, opts) {
            calls.saveMetadata.push({ canonicalGameId, meta, opts });
            return {
                operationId: `op-${canonicalGameId}`,
                updatedGame: {
                    id: canonicalGameId,
                    image: meta.cover,
                    heroImage: meta.hero,
                    logo: meta.logo,
                    artworkState: {
                        version: 2,
                        cover: { fallbackValue: meta.cover, overrideValue: null, revision: 1 },
                        hero: { fallbackValue: meta.hero, overrideValue: null, revision: 1 },
                        logo: { fallbackValue: meta.logo, overrideValue: null, revision: 1 },
                    },
                },
            };
        },
    };
    sandbox.window._patchVisibleGameCard = (game, ids, patch) => {
        for (const id of ids) {
            const card = cards.get(String(id));
            if (!card) continue;
            card.img.src = patch.cover.value;
            calls.patches.push({ id, value: patch.cover.value, canonicalGameId: patch.canonicalGameId });
        }
    };
    sandbox.window.__baddelCommitCanonicalGameUpdate = (transaction) => {
        const displayId = calls.saveMetadata.at(-1)?.opts?.displayId;
        return {
            canonicalGame: transaction.canonicalGame,
            canonicalGameId: transaction.canonicalGame.id,
            changedTypes: transaction.changedTypes,
            matchedDisplayIds: special.ambiguous?.has(displayId) ? [] : [displayId],
            duplicate: false,
            scannedCount: games.length,
        };
    };
    sandbox.renderExploreCarousel = () => { calls.renders += 1; };
    sandbox.navigateToHome = () => { calls.navigations += 1; };
    vm.createContext(sandbox);
    vm.runInContext(controllerSource(), sandbox, { filename: 'explore-controller.js' });
    return { sandbox, games, cards, calls };
}

async function waitForIdle(controller) {
    for (let i = 0; i < 200; i += 1) {
        await new Promise(resolve => setTimeout(resolve, 2));
        if (!controller.inFlightByDisplayId.size && !controller.queuedByDisplayId.size && !controller.pendingByDisplayId.size) {
            await Promise.resolve();
            return;
        }
    }
    throw new Error('controller did not become idle');
}

test('cold start hidden Home hydrates all 15 Explore covers without navigation', async () => {
    const { sandbox, games, cards, calls } = makeSandbox({ concurrency: 3, cacheHits: 2, special: { delay: 1 } });
    const controller = sandbox.window.__baddelExploreCoverHydrationController;
    controller.setSelection(games, { reason: 'cold-start-hidden' });
    assert.equal(calls.getMetadata.length, 0, 'cache lookup starts before network work settles');

    games.forEach(game => {
        cards.set(game.id, makeCard(game.id));
        controller.registerCard(game.id, cards.get(game.id), game);
    });
    sandbox.window.dispatchEvent(new sandbox.CustomEvent('baddel:home-visible', { detail: { reason: 'startup-splash-complete' } }));
    await waitForIdle(controller);

    assert.equal(calls.navigations, 0);
    assert.equal(calls.renders, 0);
    assert.equal(calls.getMetadata.length, 13);
    assert.equal(calls.cacheAllAssets.length, 13);
    for (let i = 0; i < games.length; i += 1) {
        const expected = i < 2 ? `file://cached-${i}.webp` : `file://canonical-${i}.webp`;
        assert.equal(cards.get(`display-${i}`).img.src, expected, `display-${i}`);
    }
});
for (const concurrency of [2, 3]) {
    test(`Explore hydration queue drains all requests with concurrency=${concurrency}`, async () => {
        const { sandbox, games, cards, calls } = makeSandbox({ concurrency, cacheHits: 0, special: { delay: 1 } });
        const controller = sandbox.window.__baddelExploreCoverHydrationController;
        controller.setSelection(games, { reason: 'queue-drain' });
        games.forEach(game => {
            cards.set(game.id, makeCard(game.id));
            controller.registerCard(game.id, cards.get(game.id), game);
        });
        await waitForIdle(controller);
        assert.equal(calls.cacheAllAssets.length, 15);
        assert.equal(controller.completedByDisplayId.size, 15);
    });
}

test('failed, blocked, and negative results do not stall remaining Explore requests', async () => {
    const special = {
        fail: new Set(['canonical-2']),
        block: new Set(['canonical-3']),
        noCover: new Set(['display-4']),
        delay: 1,
    };
    const { sandbox, games, cards } = makeSandbox({ concurrency: 2, cacheHits: 0, special });
    const controller = sandbox.window.__baddelExploreCoverHydrationController;
    controller.setSelection(games, { reason: 'failure-drain' });
    games.forEach(game => {
        cards.set(game.id, makeCard(game.id));
        controller.registerCard(game.id, cards.get(game.id), game);
    });
    await waitForIdle(controller);
    assert.equal(controller.failedByDisplayId.has('display-2'), true);
    assert.equal(controller.blockedByDisplayId.has('display-3'), true);
    assert.equal(controller.negativeByDisplayId.has('display-4'), true);
    assert.equal(controller.completedByDisplayId.size, 12);
    assert.equal(cards.get('display-14').img.src, 'file://canonical-14.webp');
});
test('pending result completed before mount applies only to matching card after mount', async () => {
    const { sandbox, games, cards } = makeSandbox({ count: 3, concurrency: 3, cacheHits: 0, special: { delay: 1 } });
    const controller = sandbox.window.__baddelExploreCoverHydrationController;
    controller.setSelection(games, { reason: 'pending-before-mount' });
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(controller.pendingByDisplayId.size, 3);

    cards.set('display-1', makeCard('display-1'));
    controller.registerCard('display-1', cards.get('display-1'), games[1]);
    assert.equal(cards.get('display-1').img.src, 'file://canonical-1.webp');
    assert.equal(cards.get('display-1').assignments.includes('file://canonical-0.webp'), false);
});

test('home-visible lifecycle uses two animation frames before reconciliation', async () => {
    const { sandbox, games, calls } = makeSandbox({ count: 1, cacheHits: 1 });
    const controller = sandbox.window.__baddelExploreCoverHydrationController;
    let visibleCount = 0;
    const original = controller.onHomeVisible.bind(controller);
    controller.onHomeVisible = reason => {
        visibleCount += 1;
        original(reason);
    };
    controller.setSelection(games, { reason: 'raf-test' });
    sandbox._dispatchHomeVisibleWhenReady('startup-splash-complete');
    assert.equal(visibleCount, 0);
    for (let i = 0; i < 50 && visibleCount === 0; i += 1) {
        await new Promise(resolve => setTimeout(resolve, 2));
    }
    assert.equal(visibleCount, 1);
    assert.equal(calls.raf, 2);
});
