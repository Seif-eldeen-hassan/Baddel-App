'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const APP_JS = fs.readFileSync(path.join(ROOT, 'src/js/app.js'), 'utf8');

function controllerSource() {
    const perfStart = APP_JS.indexOf('function _baddelPerfNow');
    const perfEnd = APP_JS.indexOf('function traceStartupStep', perfStart);
    assert.ok(perfStart >= 0 && perfEnd > perfStart, 'performance helpers exist');
    const perfHelpers = APP_JS.slice(perfStart, perfEnd);
    const start = APP_JS.indexOf('function _dispatchHomeVisibleWhenReady');
    const end = APP_JS.indexOf('function _explorePatchCardArtwork');
    assert.ok(start >= 0 && end > start, 'Explore hydration controller block exists');
    return perfHelpers + '\n' + APP_JS.slice(start, end);
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
        cacheLookup: [],
        cacheAllAssets: [],
        saveMetadata: [],
        patches: [],
        raf: 0,
        renders: 0,
        navigations: 0,
        diagnostics: [],
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
    sandbox.window.__baddelExploreSecondaryHydrationConcurrency = special.secondaryConcurrency || 2;
    sandbox.window.__baddelExploreArtworkRetryDelaysMs = special.retryDelays || [5, 10, 20];
    if (special.diagnostics) {
        sandbox.window.BaddelArtworkDiagnostics = {
            record(event, payload) { calls.diagnostics.push({ event, payload }); },
        };
    }
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
    sandbox.window.__baddelLoadCachedArtworkForGame = async (displayGame, canonicalGame, options = {}) => {
        const types = Array.isArray(options.types) && options.types.length ? options.types : ['cover', 'hero', 'logo'];
        calls.cacheLookup.push({ displayId: displayGame?.id, canonicalGameId: canonicalGame?.id, types });
        const result = {
            cover: null,
            hero: null,
            logo: null,
            keysTried: [],
            matchedKeys: { cover: null, hero: null, logo: null },
        };
        const index = Number(String(canonicalGame?.id || '').replace(/\D+/g, ''));
        if (types.includes('cover') && Number.isFinite(index) && index < cacheHits) {
            result.cover = `file://cached-${index}.webp`;
            result.matchedKeys.cover = canonicalGame.id;
        }
        if (types.includes('hero') && special.cachedHero?.has(canonicalGame?.id)) {
            result.hero = `file://${canonicalGame.id}-hero-cached.webp`;
            result.matchedKeys.hero = canonicalGame.id;
        }
        if (types.includes('logo') && special.cachedLogo?.has(canonicalGame?.id)) {
            result.logo = `file://${canonicalGame.id}-logo-cached.webp`;
            result.matchedKeys.logo = canonicalGame.id;
        }
        return result;
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
            assert.ok(Object.keys(assets).every(key => ['cover', 'hero', 'logo'].includes(key)));
            if (special.fail?.has(canonicalGameId)) throw new Error('download failed');
            if (special.block?.has(canonicalGameId)) return {};
            if (opts?.reason === 'explore-secondary-hydration' && special.secondaryFail?.has(canonicalGameId)) {
                throw new Error('secondary failed');
            }
            return new Promise(resolve => {
                setTimeout(() => resolve({
                    cover: assets.cover ? `file://${canonicalGameId}.webp` : null,
                    hero: assets.hero ? `file://${canonicalGameId}-hero.webp` : null,
                    logo: assets.logo ? `file://${canonicalGameId}-logo.webp` : null,
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

async function waitForSecondaryIdle(controller) {
    for (let i = 0; i < 250; i += 1) {
        await new Promise(resolve => setTimeout(resolve, 2));
        if (
            !controller.inFlightByDisplayId.size &&
            !controller.queuedByDisplayId.size &&
            !controller.secondaryInFlightByDisplayId.size &&
            !controller.secondaryQueuedByDisplayId.size
        ) {
            await Promise.resolve();
            return;
        }
    }
    throw new Error('secondary queue did not become idle');
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
    assert.equal(calls.cacheLookup.filter(call => call.types.join(',') === 'cover').length, 15);
    for (let i = 0; i < games.length; i += 1) {
        const expected = i < 2 ? `file://cached-${i}.webp` : `file://canonical-${i}.webp`;
        assert.equal(cards.get(`display-${i}`).img.src, expected, `display-${i}`);
    }
});

test('downloaded Explore cover paints before saveMetadata settles', async () => {
    let releaseSave;
    const special = { delay: 1 };
    const { sandbox, games, cards, calls } = makeSandbox({ count: 1, concurrency: 1, cacheHits: 0, special });
    sandbox.window.electronAPI.saveMetadata = async (canonicalGameId, meta, opts) => {
        calls.saveMetadata.push({ canonicalGameId, meta, opts, pending: true });
        await new Promise(resolve => { releaseSave = resolve; });
        return {
            operationId: `op-${canonicalGameId}`,
            updatedGame: { id: canonicalGameId, image: meta.cover, artworkState: { version: 2, cover: { fallbackValue: meta.cover, revision: 2 } } },
        };
    };
    const controller = sandbox.window.__baddelExploreCoverHydrationController;
    controller.setSelection(games, { reason: 'cover-before-save' });
    cards.set('display-0', makeCard('display-0'));
    controller.registerCard('display-0', cards.get('display-0'), games[0]);
    await waitForIdle(controller);
    assert.equal(cards.get('display-0').img.src, 'file://canonical-0.webp');
    assert.equal(calls.saveMetadata.length, 1);
    assert.equal(calls.saveMetadata[0].pending, true);
    releaseSave();
    await waitForSecondaryIdle(controller);
});

test('Explore cover readiness waits for same-generation mounted cover terminals', async () => {
    const { sandbox, games, cards } = makeSandbox({ count: 2, concurrency: 1, cacheHits: 2 });
    const controller = sandbox.window.__baddelExploreCoverHydrationController;
    controller.setSelection(games, { reason: 'decoded-ready' });
    const generation = controller.generation;
    games.forEach(game => {
        const card = makeCard(game.id);
        card.img.complete = true;
        card.img.naturalWidth = 320;
        card.img.decode = async () => {};
        cards.set(game.id, card);
        controller.registerCard(game.id, card, game);
    });
    const result = await controller.waitForCoversReady({ generation, timeoutMs: 100, requireDecoded: true });
    assert.equal(result.generation, generation);
    assert.equal(result.total, 2);
    assert.equal(result.loaded, 2);
    assert.equal(result.fallback, 0);
    assert.equal(result.stale, false);
});

test('Explore cover readiness never lets stale generations satisfy the current gate', async () => {
    const { sandbox, games } = makeSandbox({ count: 2, concurrency: 1, cacheHits: 0, special: { delay: 5 } });
    const controller = sandbox.window.__baddelExploreCoverHydrationController;
    controller.setSelection(games, { reason: 'stale-a' });
    const staleGeneration = controller.generation;
    const staleWait = controller.waitForCoversReady({ generation: staleGeneration, timeoutMs: 100, requireDecoded: true });
    controller.setSelection(games.slice(0, 1), { reason: 'stale-b' });
    const result = await staleWait;
    assert.equal(result.generation, staleGeneration);
    assert.equal(result.stale, true);
    assert.notEqual(controller.generation, staleGeneration);
});

test('startup reveal wakes fallback cover retry and secondary artwork queue', async () => {
    const noCover = new Set(['display-0']);
    const { sandbox, games, cards, calls } = makeSandbox({
        count: 1,
        concurrency: 1,
        cacheHits: 0,
        special: { noCover, delay: 1 },
    });
    sandbox.window.__baddelStartupReadinessCoordinator = { revealed: false };
    const controller = sandbox.window.__baddelExploreCoverHydrationController;
    controller.setSelection(games, { reason: 'fallback-before-reveal' });
    const card = makeCard('display-0');
    card.img.complete = true;
    card.img.naturalWidth = 320;
    card.img.decode = async () => {};
    cards.set('display-0', card);
    controller.registerCard('display-0', card, games[0]);
    await controller.waitForCoversReady({ generation: controller.generation, timeoutMs: 100, requireDecoded: true });
    assert.equal(controller.completedByDisplayId.get('display-0')?.fallback, true);
    assert.equal(calls.cacheAllAssets.length, 0);

    noCover.clear();
    sandbox.window.__baddelStartupReadinessCoordinator.revealed = true;
    controller.onStartupRevealed('test-reveal');
    await waitForIdle(controller);
    assert.equal(cards.get('display-0').img.src, 'file://canonical-0.webp');
    assert.notEqual(controller.completedByDisplayId.get('display-0')?.fallback, true);
    await waitForSecondaryIdle(controller);
    assert.equal(calls.cacheAllAssets.some(call => call.opts.reason === 'explore-secondary-hydration'), true);
});

test('post-reveal fallback cover keeps retrying quietly after Home opens', async () => {
    const noCover = new Set(['display-0']);
    const { sandbox, games, cards } = makeSandbox({
        count: 1,
        concurrency: 1,
        cacheHits: 0,
        special: { noCover, delay: 1, retryDelays: [5, 10] },
    });
    sandbox.window.__baddelStartupReadinessCoordinator = { revealed: false };
    const controller = sandbox.window.__baddelExploreCoverHydrationController;
    controller.setSelection(games, { reason: 'fallback-background-retry' });
    const card = makeCard('display-0');
    card.img.complete = true;
    card.img.naturalWidth = 320;
    card.img.decode = async () => {};
    cards.set('display-0', card);
    controller.registerCard('display-0', card, games[0]);
    await controller.waitForCoversReady({ generation: controller.generation, timeoutMs: 100, requireDecoded: true });
    assert.equal(controller.completedByDisplayId.get('display-0')?.fallback, true);

    sandbox.window.__baddelStartupReadinessCoordinator.revealed = true;
    controller.onStartupRevealed('test-reveal');
    await waitForIdle(controller);
    assert.equal(controller.completedByDisplayId.get('display-0')?.fallback, true);

    noCover.clear();
    await new Promise(resolve => setTimeout(resolve, 25));
    await waitForIdle(controller);
    assert.equal(cards.get('display-0').img.src, 'file://canonical-0.webp');
    assert.notEqual(controller.completedByDisplayId.get('display-0')?.fallback, true);
});

test('post-reveal secondary hero and logo retry after a transient failure', async () => {
    const secondaryFail = new Set(['canonical-0']);
    const { sandbox, games, cards, calls } = makeSandbox({
        count: 1,
        concurrency: 1,
        cacheHits: 0,
        special: { secondaryFail, delay: 1, retryDelays: [5, 10] },
    });
    sandbox.window.__baddelStartupReadinessCoordinator = { revealed: true };
    const controller = sandbox.window.__baddelExploreCoverHydrationController;
    controller.setSelection(games, { reason: 'secondary-background-retry' });
    const card = makeCard('display-0');
    card.img.complete = true;
    card.img.naturalWidth = 320;
    card.img.decode = async () => {};
    cards.set('display-0', card);
    controller.registerCard('display-0', card, games[0]);
    await waitForIdle(controller);
    await waitForSecondaryIdle(controller);
    assert.equal(controller.secondaryFailedByDisplayId.has('display-0'), true);

    secondaryFail.clear();
    await new Promise(resolve => setTimeout(resolve, 25));
    await waitForSecondaryIdle(controller);
    assert.equal(games[0].heroImage, 'file://canonical-0-hero.webp');
    assert.equal(games[0].logo, 'file://canonical-0-logo.webp');
    assert.ok(calls.cacheAllAssets.filter(call => call.opts.reason === 'explore-secondary-hydration').length >= 2);
});

test('secondary hero/logo failure does not delay or remove painted cover', async () => {
    const special = { delay: 1, secondaryFail: new Set(['canonical-0']) };
    const { sandbox, games, cards, calls } = makeSandbox({ count: 1, concurrency: 1, cacheHits: 0, special });
    const controller = sandbox.window.__baddelExploreCoverHydrationController;
    controller.setSelection(games, { reason: 'secondary-failure' });
    cards.set('display-0', makeCard('display-0'));
    controller.registerCard('display-0', cards.get('display-0'), games[0]);
    await waitForIdle(controller);
    assert.equal(cards.get('display-0').img.src, 'file://canonical-0.webp');
    await waitForSecondaryIdle(controller);
    assert.equal(cards.get('display-0').img.src, 'file://canonical-0.webp');
    assert.equal(controller.secondaryFailedByDisplayId.has('display-0'), true);
    assert.equal(calls.cacheAllAssets.some(call => call.opts.reason === 'explore-secondary-hydration'), true);
});

test('secondary hydration remains valid when artwork diagnostics are enabled', async () => {
    const { sandbox, games, cards, calls } = makeSandbox({
        count: 1,
        concurrency: 1,
        cacheHits: 0,
        special: { delay: 1, diagnostics: true },
    });
    const controller = sandbox.window.__baddelExploreCoverHydrationController;
    controller.setSelection(games, { reason: 'diagnostic-cold-start' });
    cards.set('display-0', makeCard('display-0'));
    controller.registerCard('display-0', cards.get('display-0'), games[0]);

    await waitForIdle(controller);
    await waitForSecondaryIdle(controller);

    assert.equal(games[0].heroImage, 'file://canonical-0-hero.webp');
    assert.equal(games[0].logo, 'file://canonical-0-logo.webp');
    const result = calls.diagnostics.find(entry => entry.event === 'explore-metadata-result');
    assert.equal(result?.payload?.coverValue, 'https://cdn/display-0.jpg');
    assert.equal(result?.payload?.heroValue, 'https://cdn/display-0-hero.jpg');
    assert.equal(result?.payload?.logoValue, 'https://cdn/display-0-logo.png');
});

test('selected Home hero hydrates even when it is outside the Explore selection', async () => {
    const { sandbox, games } = makeSandbox({ count: 2, concurrency: 1, cacheHits: 0, special: { delay: 1 } });
    const controller = sandbox.window.__baddelExploreCoverHydrationController;
    controller.setSelection([games[0]], { reason: 'one-card-explore' });
    const externalHeroGame = {
        id: 'external-hero',
        localGameId: 'canonical-9',
        name: 'External Hero',
        platform: 'riot',
        image: 'file://external-cover.webp',
    };

    controller.prewarmHeroArtwork([externalHeroGame], { reason: 'interactive-hover' });
    await waitForSecondaryIdle(controller);

    assert.equal(externalHeroGame.heroImage, 'file://canonical-9-hero.webp');
    assert.equal(externalHeroGame.logo, 'file://canonical-9-logo.webp');
    assert.equal(controller.interactiveSecondaryIds.has('external-hero'), true);
});

test('Explore uses separate cover and secondary concurrency limits', async () => {
    const { sandbox, games, cards, calls } = makeSandbox({
        count: 6,
        concurrency: 3,
        cacheHits: 0,
        special: { delay: 8, secondaryConcurrency: 1 },
    });
    let coverPeak = 0;
    let secondaryPeak = 0;
    const originalCacheAllAssets = sandbox.window.electronAPI.cacheAllAssets;
    sandbox.window.electronAPI.cacheAllAssets = async (assets, canonicalGameId, opts) => {
        const activeCover = sandbox.window.__baddelExploreCoverHydrationController.inFlightByDisplayId.size;
        const activeSecondary = sandbox.window.__baddelExploreCoverHydrationController.secondaryInFlightByDisplayId.size;
        if (opts.reason === 'explore-cover-hydration') coverPeak = Math.max(coverPeak, activeCover);
        if (opts.reason === 'explore-secondary-hydration') secondaryPeak = Math.max(secondaryPeak, activeSecondary);
        return originalCacheAllAssets(assets, canonicalGameId, opts);
    };
    const controller = sandbox.window.__baddelExploreCoverHydrationController;
    controller.setSelection(games, { reason: 'separate-concurrency' });
    games.forEach(game => {
        cards.set(game.id, makeCard(game.id));
        controller.registerCard(game.id, cards.get(game.id), game);
    });
    await waitForIdle(controller);
    assert.ok(coverPeak <= 3, `cover peak ${coverPeak}`);
    assert.equal(calls.cacheAllAssets.filter(call => call.opts.reason === 'explore-secondary-hydration').length, 0);
    await waitForSecondaryIdle(controller);
    assert.ok(secondaryPeak <= 1, `secondary peak ${secondaryPeak}`);
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
    assert.equal(controller.completedByDisplayId.size, 15);
    assert.equal([...controller.completedByDisplayId.values()].filter(item => item.fallback).length, 3);
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

test('scan-finished recovers a confirmed first-scan snapshot when library-updated was missed', async () => {
    const start = APP_JS.indexOf('function _handleStartupScanState');
    const end = APP_JS.indexOf('function _handleStartupLibraryUpdatedPayload', start);
    const fn = APP_JS.slice(start, end);
    const recovered = [{ id: 'fresh-game', name: 'Fresh Game' }];
    const processed = [];
    const sandbox = {
        window: {
            __baddelStartupLibrary: {},
            electronAPI: { getGames: async () => recovered },
        },
        _startupLibraryHasGames: games => Array.isArray(games) ? games.length > 0 : false,
        _processLibraryUpdatedPayload: games => processed.push(games),
        renderHomeConfirmedEmptyState() {},
        renderHomeScanErrorState() {},
        console: { warn() {} },
        Promise,
        Number,
    };
    vm.createContext(sandbox);
    vm.runInContext(`${fn}; this.handleScanState = _handleStartupScanState;`, sandbox);

    sandbox.handleScanState({ state: 'scan-finished', count: 1 });
    await new Promise(resolve => setTimeout(resolve, 0));

    assert.equal(processed.length, 1);
    assert.equal(processed[0][0].id, 'fresh-game');
    assert.equal(sandbox.window.__baddelStartupLibrary.scanRecoveryInFlight, false);
});
