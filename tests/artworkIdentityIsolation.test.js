'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const ARTWORK_SYNC_JS = fs.readFileSync(path.join(ROOT, 'src/js/app/artwork-sync.js'), 'utf8');
const ADD_GAME_MODAL_JS = fs.readFileSync(path.join(ROOT, 'src/js/addGameModal.js'), 'utf8');
const projection = require('../src/features/games/application/services/CanonicalArtworkProjection');
const { resolveCanonicalGameIdentity } = require('../src/features/games/application/services/CanonicalGameIdentityResolver');

function xboxGame(overrides = {}) {
    return {
        id: 'xbox-jigsaw',
        platform: 'xbox',
        packageFamilyName: 'Microsoft.Jigsaw_A',
        appUserModelId: 'Microsoft.Jigsaw_A!App',
        allIds: { xbox: 'Microsoft.Jigsaw_A' },
        command: 'shell:AppsFolder\\Microsoft.Jigsaw_A!App',
        path: 'C:\\Program Files\\WindowsApps',
        ...overrides,
    };
}

test('shared WindowsApps root and different Xbox package identities do not match', () => {
    const jigsaw = xboxGame();
    const solitaire = xboxGame({
        id: 'xbox-solitaire',
        packageFamilyName: 'Microsoft.Solitaire_B',
        appUserModelId: 'Microsoft.Solitaire_B!App',
        allIds: { xbox: 'Microsoft.Solitaire_B' },
        command: 'shell:AppsFolder\\Microsoft.Solitaire_B!App',
    });

    assert.equal(resolveCanonicalGameIdentity({ ...jigsaw, path: 'C:\\Program Files\\WindowsApps' }, [solitaire]).status, 'error');
    assert.equal(resolveCanonicalGameIdentity({ ...jigsaw, path: 'C:\\Program Files\\WindowsApps' }, [solitaire]).reason, 'generic-path');
    assert.equal(resolveCanonicalGameIdentity({ command: 'shell:AppsFolder\\Microsoft.Jigsaw_A!App', platform: 'xbox' }, [jigsaw]).id, 'xbox-jigsaw');
    assert.equal(resolveCanonicalGameIdentity({ command: 'shell:AppsFolder\\Microsoft.Solitaire_B!App', platform: 'xbox' }, [jigsaw]).status, 'error');
});

test('generic launcher executables are rejected as canonical identity evidence', () => {
    const genericNames = [
        'explorer.exe',
        'EpicGamesLauncher.exe',
        'RiotClientServices.exe',
        'EADesktop.exe',
        'UbisoftConnect.exe',
        'launcher.exe',
    ];
    for (const exe of genericNames) {
        const command = `C:\\Launchers\\${exe}`;
        const result = resolveCanonicalGameIdentity(
            { id: `display-${exe}`, platform: 'epic', command },
            [{ id: `local-${exe}`, platform: 'epic', command }]
        );
        assert.equal(result.status, 'error', exe);
        assert.equal(result.reason, 'generic-path', exe);
    }
});

test('ambiguous path returns ambiguous-path and unique verified executable still matches', () => {
    const command = 'C:\\Games\\Portal\\portal2.exe';
    const ambiguous = resolveCanonicalGameIdentity(
        { id: 'display', platform: 'steam', command },
        [
            { id: 'local-a', platform: 'steam', command },
            { id: 'local-b', platform: 'steam', command },
        ]
    );
    assert.equal(ambiguous.status, 'error');
    assert.equal(ambiguous.reason, 'ambiguous-path');

    const unique = resolveCanonicalGameIdentity(
        { id: 'display', platform: 'steam', command },
        [{ id: 'local-portal', platform: 'steam', command }]
    );
    assert.equal(unique.status, 'success');
    assert.equal(unique.id, 'local-portal');
    assert.equal(unique.reason, 'command');
});

function createCard(id, initialSrc = '') {
    const srcAssignments = [];
    const img = {
        dataset: { lastGoodCover: initialSrc },
        style: {},
        classList: {
            values: new Set(initialSrc ? ['img-loaded'] : []),
            add(value) { this.values.add(value); },
            remove(value) { this.values.delete(value); },
            contains(value) { return this.values.has(value); },
        },
        removeAttribute(name) {
            if (name === 'src') this.src = '';
        },
        srcAssignments,
    };
    let currentSrc = initialSrc;
    Object.defineProperty(img, 'src', {
        get() { return currentSrc; },
        set(value) {
            currentSrc = value;
            srcAssignments.push(value);
            if (typeof img._notifySrcMutation === 'function') img._notifySrcMutation(value);
        },
        configurable: true,
    });
    return {
        isConnected: true,
        dataset: { id },
        querySelector(selector) {
            return selector === '.actual-img' ? img : null;
        },
        img,
    };
}

function createArtworkSandbox(cardsById) {
    const logs = [];
    const sandbox = {
        window: {},
        document: {
            querySelector(selector) {
                const match = String(selector).match(/^\[data-id="(.+)"\]$/);
                return match ? cardsById.get(match[1]) || null : null;
            },
            querySelectorAll(selector) {
                const match = String(selector).match(/^\[data-id="(.+)"\]$/);
                const card = match ? cardsById.get(match[1]) : null;
                return card ? [card] : [];
            },
        },
        CSS: { escape(value) { return String(value).replace(/"/g, '\\"'); } },
        console: { info(label, payload) { logs.push({ label, payload }); }, warn() {}, error() {}, debug() {}, log() {} },
        localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
        safeImageUrl(value) { return value || null; },
        Image: class TestImage {
            constructor() {
                TestImage.instances.push(this);
            }
            set src(value) { this._src = value; }
            get src() { return this._src; }
        },
        Map,
        WeakMap,
        Set,
        JSON,
        String,
        Number,
        Boolean,
        Array,
        Object,
        Promise,
        Date,
        currentHeroGameId: null,
    };
    sandbox.Image.instances = [];
    sandbox.window.window = sandbox.window;
    sandbox.window.document = sandbox.document;
    sandbox.window.CSS = sandbox.CSS;
    sandbox.window.console = sandbox.console;
    sandbox.window.localStorage = sandbox.localStorage;
    sandbox.window.BaddelCanonicalArtworkProjection = projection;
    sandbox.window.BaddelCanonicalGameIdentityResolver = { resolveCanonicalGameIdentity };
    sandbox.window._vs = { cardCache: new Map() };
    sandbox.logs = logs;
    vm.createContext(sandbox);
    vm.runInContext(ARTWORK_SYNC_JS, sandbox, { filename: 'artwork-sync.js' });
    return sandbox;
}

test('revision-guarded visible card patch ignores stale preload completion', () => {
    const card = createCard('display-a', 'file://old.webp');
    const sandbox = createArtworkSandbox(new Map([['display-a', card]]));

    sandbox.window._patchVisibleGameCard({ id: 'canonical-a', image: 'file://rev4.webp' }, ['display-a'], {
        canonicalGameId: 'canonical-a',
        operationId: 'op-4',
        cover: { changed: true, value: 'file://rev4.webp', revision: 4 },
    });
    sandbox.window._patchVisibleGameCard({ id: 'canonical-a', image: 'file://rev5.webp' }, ['display-a'], {
        canonicalGameId: 'canonical-a',
        operationId: 'op-5',
        cover: { changed: true, value: 'file://rev5.webp', revision: 5 },
    });

    const [rev4, rev5] = sandbox.Image.instances;
    rev5.onload();
    assert.equal(card.img.src, 'file://rev5.webp');
    rev4.onload();
    assert.equal(card.img.src, 'file://rev5.webp');
});

test('stale operation, disconnected card, and reused card completions are ignored', () => {
    const staleCard = createCard('display-a', 'file://old.webp');
    const disconnectedCard = createCard('display-b', 'file://old.webp');
    const reusedCard = createCard('display-c', 'file://old.webp');
    const sandbox = createArtworkSandbox(new Map([
        ['display-a', staleCard],
        ['display-b', disconnectedCard],
        ['display-c', reusedCard],
    ]));

    sandbox.window.__baddelArtworkEventRuntime.latestOperations.set('canonical-a:cover', 'newer-op');
    sandbox.window._patchVisibleGameCard({ id: 'canonical-a', image: 'file://stale-op.webp' }, ['display-a'], {
        canonicalGameId: 'canonical-a',
        operationId: 'old-op',
        cover: { changed: true, value: 'file://stale-op.webp', revision: 7 },
    });
    disconnectedCard.isConnected = false;
    sandbox.window._patchVisibleGameCard({ id: 'canonical-b', image: 'file://disconnected.webp' }, ['display-b'], {
        canonicalGameId: 'canonical-b',
        operationId: 'op-b',
        cover: { changed: true, value: 'file://disconnected.webp', revision: 1 },
    });
    sandbox.window._patchVisibleGameCard({ id: 'canonical-c', image: 'file://reused.webp' }, ['display-c'], {
        canonicalGameId: 'canonical-c',
        operationId: 'op-c',
        cover: { changed: true, value: 'file://reused.webp', revision: 1 },
    });
    reusedCard.dataset.id = 'display-c-reused';

    for (const image of sandbox.Image.instances) image.onload();

    assert.equal(staleCard.img.src, 'file://old.webp');
    assert.equal(disconnectedCard.img.src, 'file://old.webp');
    assert.equal(reusedCard.img.src, 'file://old.webp');
});

test('explicit cover reset clears the old visible cover immediately', () => {
    const card = createCard('display-a', 'file://old-user-cover.webp');
    const sandbox = createArtworkSandbox(new Map([['display-a', card]]));

    sandbox.window._patchVisibleGameCard({ id: 'canonical-a' }, ['display-a'], {
        canonicalGameId: 'canonical-a',
        operationId: 'reset-1',
        cover: { changed: true, value: null, revision: 6 },
    });

    assert.equal(card.img.src, '');
    assert.equal(card.img.dataset.lastGoodCover, undefined);
    assert.equal(card.img.classList.contains('img-loaded'), false);
});

test('shuffled first-session canonical commits never assign another game cover to a card', () => {
    const games = [
        ['detroit', 'file://detroit.webp'],
        ['jigsaw', 'file://jigsaw.webp'],
        ['solitaire', 'file://solitaire.webp'],
        ['doom', 'file://doom.webp'],
        ['fall-guys', 'file://fall-guys.webp'],
        ['brawlhalla', 'file://brawlhalla.webp'],
    ];
    const cards = new Map(games.map(([id]) => [id, createCard(id)]));
    const sandbox = createArtworkSandbox(cards);
    sandbox.window.allGamesData = games.map(([id]) => ({ id, localGameId: `local-${id}`, image: null }));
    sandbox.window._allGamesCache = sandbox.window.allGamesData.map(game => ({ ...game }));
    sandbox.window._allGamesRawCache = sandbox.window.allGamesData.map(game => ({ ...game }));

    for (const [id, cover] of games.slice().reverse()) {
        sandbox.window.__baddelCommitCanonicalGameUpdate({
            id: `local-${id}`,
            image: cover,
            artworkState: {
                version: 2,
                cover: { fallbackValue: cover, overrideValue: null, revision: 1 },
                hero: { fallbackValue: null, overrideValue: null, revision: 0 },
                logo: { fallbackValue: null, overrideValue: null, revision: 0 },
            },
        }, { reason: 'first-start-test', changedTypes: ['cover'] });
    }

    for (const [id, cover] of games) {
        assert.equal(cards.get(id).img.src, cover, id);
    }
});

test('MutationObserver-style cross-card guard rejects transient wrong cover assignments across fifty events', () => {
    const games = Array.from({ length: 50 }, (_, index) => [`game-${index}`, `file://game-${index}.webp`]);
    const violations = [];
    const cards = new Map(games.map(([id, cover]) => {
        const card = createCard(id);
        card.img._notifySrcMutation = value => {
            if (value && value !== cover) violations.push({ id, value, expected: cover });
        };
        return [id, card];
    }));
    const sandbox = createArtworkSandbox(cards);
    sandbox.window.allGamesData = games.map(([id]) => ({ id, localGameId: `local-${id}`, image: null }));
    sandbox.window._allGamesCache = sandbox.window.allGamesData.map(game => ({ ...game }));
    sandbox.window._allGamesRawCache = sandbox.window.allGamesData.map(game => ({ ...game }));

    const shuffled = games.slice().sort((a, b) => b[0].localeCompare(a[0]));
    for (const [id, cover] of shuffled) {
        sandbox.window.__baddelCommitCanonicalGameUpdate({
            canonicalGame: {
                id: `local-${id}`,
                image: cover,
                artworkState: {
                    version: 2,
                    cover: { fallbackValue: cover, overrideValue: null, revision: 1 },
                },
            },
            changedTypes: ['cover'],
            operationId: `op-${id}`,
        }, { reason: 'first-start-mutation-observer' });
    }

    assert.deepEqual(violations, []);
    for (const [id, cover] of games) assert.equal(cards.get(id).img.src, cover, id);
});

test('Settings projection helper preserves display id and records canonical localGameId', () => {
    const sandbox = {
        window: {
            BaddelCanonicalArtworkProjection: projection,
        },
        document: { getElementById() { return null; }, querySelectorAll() { return []; } },
        console: { log() {}, warn() {}, error() {}, info() {} },
        localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
        Map,
        Set,
        JSON,
        String,
        Number,
        Boolean,
        Array,
        Object,
        Promise,
        Date,
    };
    sandbox.window.window = sandbox.window;
    vm.createContext(sandbox);
    vm.runInContext(ADD_GAME_MODAL_JS, sandbox, { filename: 'addGameModal.js' });

    const display = { id: 'xbox-jigsaw-display', localGameId: 'old-local', platform: 'xbox', image: 'file://old.webp' };
    const canonical = { id: 'local-jigsaw', image: 'file://new.webp', artworkSource: 'settings' };
    const projected = sandbox.projectCanonicalResultOntoDisplay(display, canonical);

    assert.equal(projected.id, 'xbox-jigsaw-display');
    assert.equal(projected.localGameId, 'local-jigsaw');
    assert.equal(projected.image, 'file://new.webp');
    assert.equal(display.id, 'xbox-jigsaw-display');
});
