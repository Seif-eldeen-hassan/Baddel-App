'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const ARTWORK_SYNC_JS = fs.readFileSync(path.join(ROOT, 'src/js/app/artwork-sync.js'), 'utf8');
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
        encodeURIComponent,
        decodeURIComponent,
        safeImageUrl(value) { return value || null; },
        renderRecentlyPlayed() {},
        currentHeroGameId: null,
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

function v2Cover(value) {
    return {
        version: 2,
        cover: {
            locked: true,
            overrideValue: value,
            overrideSource: 'settings',
            fallbackValue: null,
            revision: 4,
        },
        hero: { locked: false, overrideValue: null, fallbackValue: null, revision: 0 },
        logo: { locked: false, overrideValue: null, fallbackValue: null, revision: 0 },
    };
}

test('canonical commit updates only strong identity matches and preserves unrelated games', () => {
    const games = [
        {
            id: 'epic:fall-guys',
            localGameId: 'local-fall-guys',
            image: 'file:///platform/fall-guys-cover.webp',
            artworkState: { version: 2, cover: { revision: 1 } },
        },
        {
            id: 'local-death-stranding',
            image: 'file:///platform/death-stranding-cover.webp',
            artworkState: { version: 2, cover: { revision: 9 } },
        },
        {
            id: 'local-hogwarts',
            image: 'file:///platform/hogwarts-cover.webp',
            artworkState: { version: 2, cover: { revision: 12 } },
        },
    ];
    const sandbox = createCoordinatorSandbox(games);

    sandbox.window.__baddelCommitCanonicalGameUpdate({
        id: 'local-fall-guys',
        allIds: { epic: 'fall-guys' },
        image: 'file:///user_artwork/fall-guys/cover.webp',
        cover: 'file:///user_artwork/fall-guys/cover.webp',
        coverUrl: 'file:///user_artwork/fall-guys/cover.webp',
        artworkState: v2Cover('file:///user_artwork/fall-guys/cover.webp'),
        customArtworkLocked: true,
        artworkSource: 'settings',
    }, { reason: 'test', changedTypes: ['cover'] });

    const [fallGuys, deathStranding, hogwarts] = sandbox.window.allGamesData;
    assert.equal(fallGuys.image, 'file:///user_artwork/fall-guys/cover.webp');
    assert.equal(fallGuys.localGameId, 'local-fall-guys');
    assert.equal(fallGuys._artworkIdentityMatchReason, 'localGameId');

    assert.equal(deathStranding.image, 'file:///platform/death-stranding-cover.webp');
    assert.equal(deathStranding.localGameId, undefined);
    assert.equal(deathStranding._artworkIdentityMatchReason, undefined);
    assert.equal(deathStranding.artworkState.cover.revision, 9);

    assert.equal(hogwarts.image, 'file:///platform/hogwarts-cover.webp');
    assert.equal(hogwarts.localGameId, undefined);
    assert.equal(hogwarts._artworkIdentityMatchReason, undefined);
    assert.equal(hogwarts.artworkState.cover.revision, 12);

    assert.deepEqual(sandbox.patchedIds, ['epic:fall-guys']);
    assert.equal(sandbox.window._vs.cardCache.has('epic:fall-guys'), false);
    assert.equal(sandbox.window._vs.cardCache.has('local-death-stranding'), true);
    assert.equal(sandbox.window._vs.cardCache.has('local-hogwarts'), true);

    const summary = sandbox.infoLogs.find(log => log.label === '[ArtworkCommitSummary]')?.payload;
    assert.deepEqual(Array.from(summary.matchedDisplayIds), ['epic:fall-guys']);
    assert.equal(summary.matchedCount, 1);
});

test('canonical commit updates multiple strong representations of the same game only', () => {
    const games = [
        { id: 'local-fall-guys', image: 'local-old.webp' },
        { id: 'epic:fall-guys', localGameId: 'local-fall-guys', image: 'synced-old.webp' },
        { id: 'same-title-only', name: 'Fall Guys', image: 'same-title-cover.webp' },
    ];
    const sandbox = createCoordinatorSandbox(games);

    sandbox.window.__baddelCommitCanonicalGameUpdate({
        id: 'local-fall-guys',
        image: 'file:///user_artwork/fall-guys/cover.webp',
        cover: 'file:///user_artwork/fall-guys/cover.webp',
        artworkState: v2Cover('file:///user_artwork/fall-guys/cover.webp'),
    }, { reason: 'test', changedTypes: ['cover'] });

    const [local, synced, titleOnly] = sandbox.window.allGamesData;
    assert.equal(local.image, 'file:///user_artwork/fall-guys/cover.webp');
    assert.equal(local._artworkIdentityMatchReason, 'id');
    assert.equal(synced.image, 'file:///user_artwork/fall-guys/cover.webp');
    assert.equal(synced._artworkIdentityMatchReason, 'localGameId');
    assert.equal(titleOnly.image, 'same-title-cover.webp');
    assert.equal(titleOnly._artworkIdentityMatchReason, undefined);

    const summary = sandbox.infoLogs.find(log => log.label === '[ArtworkCommitSummary]')?.payload;
    assert.deepEqual(Array.from(summary.matchedDisplayIds), ['local-fall-guys', 'epic:fall-guys']);
    assert.equal(summary.matchedCount, 2);
    assert.deepEqual(sandbox.patchedIds, ['local-fall-guys', 'epic:fall-guys']);
});

test('canonical commit honors verified Steam and Epic identities without title-only matching', () => {
    const games = [
        { id: 'steam-display', platform: 'steam', appId: '12345', image: 'steam-old.webp' },
        { id: 'epic-display', platform: 'epic', appName: 'FallGuys', namespace: 'fall-guys-ns', image: 'epic-old.webp' },
        { id: 'title-only', name: 'Steam Game', image: 'title-old.webp' },
    ];
    const steamSandbox = createCoordinatorSandbox(games);
    steamSandbox.window.__baddelCommitCanonicalGameUpdate({
        id: 'local-steam',
        allIds: { steam: '12345' },
        image: 'steam-new.webp',
        artworkState: v2Cover('steam-new.webp'),
    }, { reason: 'steam', changedTypes: ['cover'] });

    assert.equal(steamSandbox.window.allGamesData[0].image, 'steam-new.webp');
    assert.equal(steamSandbox.window.allGamesData[0]._artworkIdentityMatchReason, 'steam');
    assert.equal(steamSandbox.window.allGamesData[1].image, 'epic-old.webp');
    assert.equal(steamSandbox.window.allGamesData[2].image, 'title-old.webp');

    const epicSandbox = createCoordinatorSandbox(games);
    epicSandbox.window.__baddelCommitCanonicalGameUpdate({
        id: 'local-epic',
        appName: 'FallGuys',
        namespace: 'fall-guys-ns',
        image: 'epic-new.webp',
        artworkState: v2Cover('epic-new.webp'),
    }, { reason: 'epic', changedTypes: ['cover'] });

    assert.equal(epicSandbox.window.allGamesData[0].image, 'steam-old.webp');
    assert.equal(epicSandbox.window.allGamesData[1].image, 'epic-new.webp');
    assert.equal(epicSandbox.window.allGamesData[1]._artworkIdentityMatchReason, 'epic');
    assert.equal(epicSandbox.window.allGamesData[2].image, 'title-old.webp');
});
