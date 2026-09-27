'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'app', 'artwork-sync.js'), 'utf8');

function productionRtiaSource() {
    const start = source.indexOf('const _RTIA_DISK_CONCURRENCY');
    const end = source.indexOf('// ── Local artwork state', start);
    assert.ok(start >= 0 && end > start);
    return source.slice(start, end) + '\n;globalThis.__rtia = {' +
        ' hydrateAll: _rtia_hydrateAll, warmOne: _rtia_warmOne,' +
        ' running: () => _rtia_running, inFlight: _rtiaWarmInFlightByCanonicalId };';
}

function makeRuntime({ delayMs = 0 } = {}) {
    const calls = { cache: [], hydrate: [], render: [] };
    const artCache = new Map();
    const sandbox = {
        window: null,
        console: { warn() {} },
        setTimeout,
        clearTimeout,
        Promise,
        Map,
        Date,
        String,
        Array,
        _suggFeaturedGame: null,
        _suggKey: game => `${game._platform}:${game.id}`,
        _suggArtCacheGet: key => artCache.get(key) || null,
        _suggArtCacheSet: (key, value) => artCache.set(key, { ...(artCache.get(key) || {}), ...value }),
        _suggArtCacheDeleteField: (key, field) => {
            const current = artCache.get(key);
            if (current) delete current[field];
        },
        _suggArtCachePopulate: game => {
            artCache.set(`${game._platform}:${game.id}`, {
                poster: game.image || null,
                hero: game.heroImage || null,
                logo: game.logo || null,
            });
        },
        _bulkArtworkCanonicalGameFor: game => ({ id: game.canonicalGameId }),
        _suggReRenderOne: game => calls.render.push(game.id),
        _suggHydrateArt: game => calls.hydrate.push(game.id),
    };
    sandbox.window = sandbox;
    sandbox.electronAPI = {
        probeLocalImage: async () => true,
        getCachedImage: async () => null,
    };
    sandbox.__baddelLoadCachedArtworkForGame = async (_displayGame, canonicalGame) => {
        calls.cache.push(canonicalGame.id);
        if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
        return {
            cover: `file://${canonicalGame.id}-cover.webp`,
            hero: `file://${canonicalGame.id}-hero.webp`,
            logo: `file://${canonicalGame.id}-logo.webp`,
        };
    };
    vm.createContext(sandbox);
    vm.runInContext(productionRtiaSource(), sandbox, { filename: 'production-rtia.js' });
    return { sandbox, calls };
}

test('overlapping Ready to Install batches are not dropped', async () => {
    const { sandbox, calls } = makeRuntime({ delayMs: 5 });
    const first = { id: 'display-a', canonicalGameId: 'canonical-a', _platform: 'epic' };
    const second = { id: 'display-b', canonicalGameId: 'canonical-b', _platform: 'steam' };

    await Promise.all([
        sandbox.__rtia.hydrateAll([first]),
        sandbox.__rtia.hydrateAll([second]),
    ]);

    assert.deepEqual(new Set(calls.cache), new Set(['canonical-a', 'canonical-b']));
    assert.equal(first.heroImage, 'file://canonical-a-hero.webp');
    assert.equal(second.heroImage, 'file://canonical-b-hero.webp');
    assert.equal(sandbox.__rtia.running(), 0);
});

test('canonical request coalescing applies artwork to every display alias', async () => {
    const { sandbox, calls } = makeRuntime({ delayMs: 5 });
    const first = { id: 'alias-a', canonicalGameId: 'canonical-shared', _platform: 'epic', _metaHydrated: true };
    const second = { id: 'alias-b', canonicalGameId: 'canonical-shared', _platform: 'epic', _metaHydrated: true };

    await Promise.all([
        sandbox.__rtia.warmOne(first),
        sandbox.__rtia.warmOne(second),
    ]);

    assert.equal(calls.cache.filter(id => id === 'canonical-shared').length, 1);
    for (const game of [first, second]) {
        assert.equal(game.image, 'file://canonical-shared-cover.webp');
        assert.equal(game.heroImage, 'file://canonical-shared-hero.webp');
        assert.equal(game.logo, 'file://canonical-shared-logo.webp');
    }
    assert.ok(calls.render.includes('alias-a'));
    assert.ok(calls.render.includes('alias-b'));
});
