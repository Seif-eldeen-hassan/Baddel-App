'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const ARTWORK_SYNC_JS = fs.readFileSync(path.join(ROOT, 'src/js/app/artwork-sync.js'), 'utf8');
const APP_JS = fs.readFileSync(path.join(ROOT, 'src/js/app.js'), 'utf8');
const HERO_JS = fs.readFileSync(path.join(ROOT, 'src/js/app/hero.js'), 'utf8');
const GAME_CARD_JS = fs.readFileSync(path.join(ROOT, 'src/js/app/game-card.js'), 'utf8');
const projection = require('../src/features/games/application/services/CanonicalArtworkProjection');

function createLocalStorage() {
    const map = new Map();
    return {
        getItem(key) { return map.has(key) ? map.get(key) : null; },
        setItem(key, value) { map.set(String(key), String(value)); },
        removeItem(key) { map.delete(String(key)); },
    };
}

function createDocumentStub(patchedIds) {
    return {
        querySelector(selector) {
            const match = String(selector).match(/^\[data-id="(.+)"\]$/);
            if (!match) return null;
            const id = match[1];
            return {
                querySelector(childSelector) {
                    if (childSelector !== '.actual-img') return null;
                    patchedIds.push(id);
                    return {
                        classList: { remove() {}, add() {} },
                        addEventListener() {},
                        style: {},
                        src: '',
                    };
                },
            };
        },
    };
}

function createCoordinatorSandbox(games) {
    const patchedIds = [];
    const infoLogs = [];
    const sandbox = {
        window: {},
        console: {
            info(label, payload) { infoLogs.push({ label, payload }); },
            warn() {},
            error() {},
            debug() {},
            log() {},
        },
        localStorage: createLocalStorage(),
        document: createDocumentStub(patchedIds),
        CSS: { escape(value) { return String(value).replace(/"/g, '\\"'); } },
        Date,
        Map,
        Set,
        JSON,
        String,
        Number,
        Boolean,
        Array,
        Object,
        Promise,
        safeImageUrl(value) { return value || null; },
        currentHeroGameId: null,
        renderRecentlyPlayed() { throw new Error('renderRecentlyPlayed must not run for artwork commits'); },
    };
    sandbox.window.window = sandbox.window;
    sandbox.window.console = sandbox.console;
    sandbox.window.localStorage = sandbox.localStorage;
    sandbox.window.document = sandbox.document;
    sandbox.window.CSS = sandbox.CSS;
    sandbox.window.BaddelCanonicalArtworkProjection = projection;
    sandbox.window.allGamesData = games.map(game => ({ ...game }));
    sandbox.window._allGamesCache = games.map(game => ({ ...game }));
    sandbox.window._allGamesRawCache = games.map(game => ({ ...game }));
    sandbox.window._vs = { cardCache: new Map(games.map(game => [String(game.id), { id: game.id }])) };
    sandbox.patchedIds = patchedIds;
    sandbox.infoLogs = infoLogs;
    vm.createContext(sandbox);
    vm.runInContext(ARTWORK_SYNC_JS, sandbox, { filename: 'artwork-sync.js' });
    return sandbox;
}

function artworkState({ coverRevision = 0, heroRevision = 0, logoRevision = 0 } = {}) {
    return {
        version: 2,
        cover: { locked: false, fallbackValue: 'cover.webp', revision: coverRevision },
        hero: { locked: false, fallbackValue: 'hero.webp', revision: heroRevision },
        logo: { locked: false, fallbackValue: 'logo.webp', revision: logoRevision },
    };
}

test('hero-only canonical commit does not patch Installed cover cards or rerender JBI', () => {
    const sandbox = createCoordinatorSandbox([
        { id: 'epic:fall-guys', localGameId: 'local-fall-guys', image: 'old-cover.webp' },
    ]);

    const summary = sandbox.window.__baddelCommitCanonicalGameUpdate({
        id: 'local-fall-guys',
        heroImage: 'new-hero.webp',
        artworkState: artworkState({ heroRevision: 10 }),
    }, { reason: 'settings-save', changedTypes: ['hero'] });

    assert.deepEqual(Array.from(summary.changedTypes), ['hero']);
    assert.deepEqual(Array.from(summary.matchedDisplayIds), ['epic:fall-guys']);
    assert.deepEqual(sandbox.patchedIds, []);
});

test('cover-only canonical commit patches only strongly matched card ids', () => {
    const sandbox = createCoordinatorSandbox([
        { id: 'epic:fall-guys', localGameId: 'local-fall-guys', image: 'old-cover.webp' },
        { id: 'title-only', name: 'Fall Guys', image: 'title-cover.webp' },
    ]);

    const summary = sandbox.window.__baddelCommitCanonicalGameUpdate({
        id: 'local-fall-guys',
        image: 'new-cover.webp',
        artworkState: artworkState({ coverRevision: 11 }),
    }, { reason: 'settings-save', changedTypes: ['cover'] });

    assert.deepEqual(Array.from(summary.changedTypes), ['cover']);
    assert.deepEqual(Array.from(summary.matchedDisplayIds), ['epic:fall-guys']);
    assert.deepEqual(sandbox.patchedIds, ['epic:fall-guys']);
});

test('duplicate save echo revision produces no additional DOM work', () => {
    const sandbox = createCoordinatorSandbox([
        { id: 'epic:fall-guys', localGameId: 'local-fall-guys', image: 'old-cover.webp' },
    ]);
    const updated = {
        id: 'local-fall-guys',
        image: 'new-cover.webp',
        artworkState: artworkState({ coverRevision: 12 }),
    };

    sandbox.window.__baddelCommitCanonicalGameUpdate(updated, { reason: 'settings-save', changedTypes: ['cover'] });
    sandbox.patchedIds.length = 0;
    const echo = sandbox.window.__baddelCommitCanonicalGameUpdate(updated, {
        reason: 'game-image-updated',
        changedTypes: ['cover'],
        suppressDuplicateRevision: true,
    });

    assert.equal(echo.duplicate, true);
    assert.deepEqual(Array.from(echo.changedTypes), []);
    assert.deepEqual(sandbox.patchedIds, []);
    const dedup = sandbox.infoLogs.filter(log => log.label === '[ArtworkEventDedup]').at(-1).payload;
    assert.equal(dedup.action, 'ignored');
});

test('game-image-updated handler routes through coordinator and never structural renders artwork events', () => {
    const start = APP_JS.indexOf('window.electronAPI.onGameImageUpdated');
    const block = APP_JS.slice(start, start + 1600);
    assert.match(block, /__baddelCommitCanonicalGameUpdate/);
    assert.match(block, /suppressDuplicateRevision:\s*true/);
    assert.doesNotMatch(block, /applyFilters\(\)/);
    assert.doesNotMatch(block, /renderExploreCarousel\(\)/);
    assert.doesNotMatch(block, /renderRecentlyPlayed\(\)/);
});

test('library-updated handler coalesces events and delegates snapshot diff processing', () => {
    const start = APP_JS.indexOf('window.electronAPI.onLibraryUpdated');
    const block = APP_JS.slice(start, start + 700);
    assert.match(block, /setTimeout/);
    assert.match(block, /_processLibraryUpdatedPayload/);
    assert.match(APP_JS, /function _classifyLibrarySnapshot/);
    assert.match(APP_JS, /CARD_COVER/);
    assert.match(APP_JS, /SURFACE_ART/);
});

test('Explore rendering uses keyed reconciliation instead of clearing unchanged DOM', () => {
    const start = APP_JS.indexOf('function renderExploreCarousel');
    const body = APP_JS.slice(start, start + 2500);
    assert.doesNotMatch(body, /grid\.innerHTML\s*=\s*''/);
    assert.match(body, /window\._exploreRenderedIds/);
    assert.match(body, /window\._exploreRenderedNodes/);
    assert.match(body, /replaceChildren\(fragment\)/);
});

test('Home Hero transition controller debounces hover and protects atomic Hero and Logo commits', () => {
    assert.match(HERO_JS, /function __baddelRequestHomeHeroTransition/);
    assert.match(HERO_JS, /setTimeout\(\(\) =>/);
    assert.match(HERO_JS, /const delay = options\.immediate \? 0 : 120/);
    assert.match(HERO_JS, /_homeHeroRequestToken/);
    assert.match(HERO_JS, /Promise\.all/);
    assert.match(HERO_JS, /requestAnimationFrame/);
    assert.match(HERO_JS, /token !== _homeHeroRequestToken/);
});

test('Home Hero preload cache deduplicates URL loads and is bounded', () => {
    assert.match(HERO_JS, /const _homeHeroPreloadCache = new Map/);
    assert.match(HERO_JS, /_HOME_HERO_PRELOAD_CACHE_MAX = 150/);
    assert.match(HERO_JS, /if \(cached\) return cached/);
    assert.match(HERO_JS, /while \(_homeHeroPreloadCache\.size > _HOME_HERO_PRELOAD_CACHE_MAX\)/);
});

test('card hover producers use the Home Hero transition controller', () => {
    assert.match(GAME_CARD_JS, /__baddelRequestHomeHeroTransition\?\.\(\s*game\.id,\s*\{ reason: 'card-hover' \}/);
    assert.match(GAME_CARD_JS, /__baddelRequestHomeHeroTransition\?\.\(\s*game\.id,\s*\{ reason: 'jbi-hover' \}/);
});
