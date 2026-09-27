'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
const SUGGESTIONS = read('src', 'js', 'app', 'suggestions.js');
const ROULETTE = read('src', 'js', 'app', 'roulette.js');
const PANELS = read('src', 'js', 'accounts', 'platform-panels.js');
const HTML = read('src', 'dashboard.html');

function makeSuggestionSandbox({ installedIds = new Set() } = {}) {
    const libraries = {
        steam: [
            { id: 'steam-10', appName: '10', title: 'Shared Game', canonicalGameId: 'game-shared', ownedByAccountIds: ['s1'] },
            { id: 'steam-11', appName: '11', title: 'Steam Game', canonicalGameId: 'game-steam', ownedByAccountIds: ['s1'] },
        ],
        epic: [
            { id: 'epic_shared', appName: 'shared-app', title: 'Shared Game', canonicalGameId: 'game-shared', ownedByAccountIds: ['e1'] },
        ],
        gog: [
            { id: 'gog_100', productId: '100', title: 'Shared Game', canonicalGameId: 'game-shared', ownedByAccountIds: ['g1'] },
            { id: 'gog_200', productId: '200', title: 'GOG Only', canonicalGameId: 'game-gog', ownedByAccountIds: ['g1'] },
            { id: 'gog_300', productId: '300', title: 'Installed GOG', canonicalGameId: 'game-installed-gog', ownedByAccountIds: ['g1'] },
            { id: 'gog_bad', productId: 'not-a-product', title: 'Invalid GOG', ownedByAccountIds: ['g1'] },
            { id: 'gog_400', productId: '400', title: 'Wrong Account', ownedByAccountIds: ['other'] },
        ],
    };
    const accounts = {
        steam: [{ id: 's1' }], epic: [{ id: 'e1' }], gog: [{ id: 'g1', platformAccountId: 'gog-user-1' }],
    };
    const document = {
        getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; },
    };
    const sandbox = {
        window: null, document, localStorage: { getItem() { return null; }, setItem() {} },
        console: { log() {}, warn() {}, error() {}, group() {}, groupEnd() {} },
        setTimeout() { return 1; }, clearTimeout() {}, setInterval() { return 1; }, clearInterval() {},
        Map, Set, Promise, Date, Math, String, Number, Array, Object, JSON,
        getPosterUrl() { return ''; }, updateSmartSidebarCounts() {},
        _agIsInstalled(game) { return installedIds.has(String(game.id)); },
    };
    sandbox.window = {
        document, allGamesData: [], addEventListener() {},
        electronAPI: {
            platformSyncGetCached: async platform => ({ games: libraries[platform] || [] }),
            platformSyncGetAccounts: async platform => ({ accounts: accounts[platform] || [] }),
            platformSyncGetState: async () => ({ state: { phase: 'complete' } }),
        },
    };
    sandbox.globalThis = sandbox.window;
    vm.createContext(sandbox);
    vm.runInContext(SUGGESTIONS, sandbox, { filename: 'suggestions.js' });
    return sandbox;
}

test('Home Ready to Install builds GOG bucket, preserves provider variants, and excludes installed/non-installable GOG', async () => {
    const sandbox = makeSuggestionSandbox({ installedIds: new Set(['gog_300']) });
    await sandbox.window._buildSyncedSuggestions();
    sandbox.window.setSyncedFilter('all', null);

    const gog = sandbox.window._suggSelectForFilter('gog', 42);
    assert.equal(sandbox.window._suggGetState().gogItems.length, 2);
    assert.deepEqual(Array.from(gog, game => game.id).sort(), ['gog_100', 'gog_200']);
    assert.ok(gog.every(game => game._platform === 'gog'));
    assert.ok(gog.every(game => game.ownedByAccountIds.includes('g1')));

    const recommended = sandbox.window._suggSelectForFilter('all', 42);
    assert.ok(recommended.some(game => game._platform === 'gog'));
    assert.equal(recommended.filter(game => game._canonicalKey === 'canonical:game-shared').length, 1);

    for (const [platform, expectedId] of [['steam', 'steam-10'], ['epic', 'epic_shared'], ['gog', 'gog_100']]) {
        const providerView = sandbox.window._suggSelectForFilter(platform, 42);
        const shared = providerView.find(game => game._canonicalKey === 'canonical:game-shared');
        assert.equal(shared?.id, expectedId);
        assert.equal(shared?._platform, platform);
    }

    let installGame = null;
    sandbox.window._gdOpenInstallPickerForGame = game => { installGame = game; };
    sandbox.window.suggInstall('gog', 'gog_100');
    assert.equal(installGame.productId, '100');
    assert.deepEqual(Array.from(installGame.platforms).sort(), ['epic', 'gog', 'steam']);
    assert.deepEqual(Array.from(installGame.ownedByAccountIds), ['g1']);
});

function makeRouletteSandbox(games, suggestions = []) {
    const elements = new Map();
    const element = id => elements.get(id) || (() => {
        const value = { id, style: {}, dataset: {}, disabled: false, innerHTML: '', innerText: '', classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, removeAttribute() {} };
        elements.set(id, value); return value;
    })();
    const document = { getElementById: element, querySelector() { return null; }, querySelectorAll() { return []; }, createElement() { return element(`new-${elements.size}`); } };
    const sandbox = {
        window: null, document, console: { log() {}, warn() {}, error() {} },
        setTimeout() { return 1; }, clearTimeout() {}, Map, Set, Date, Math, String, Array, Object, Promise,
        _agIsInstalled(game) { return !!(game.installVerified || game.path || game.command); },
        _suggKey(game) { return `${game._platform}:${game.id}`; }, _suggArtCacheGet() { return {}; },
        _preferLocalImage(values) { return values.find(Boolean) || null; }, getPosterUrl() { return null; },
        getPosterUrlInstalled() { return null; }, isUsableImageUrl() { return null; }, showToast() {},
    };
    sandbox.window = {
        document, allGamesData: games, _suggAllGames: suggestions, electronAPI: {},
        _gameHasInstalledGogEvidence(game) {
            return String(game.scannerPlatform || '').toLowerCase() === 'gog' ||
                (game.installVerified === true && game.installSource === 'download' && game.platform === 'gog');
        },
    };
    sandbox.globalThis = sandbox.window;
    vm.createContext(sandbox);
    vm.runInContext(ROULETTE, sandbox, { filename: 'roulette.js' });
    return { sandbox, element };
}

test('installed Spin accepts verified GOG, rejects ownership-only GOG, enables a GOG-only pool, and uses canonical custom IDs', () => {
    const installed = { id: 'local-gog', canonicalGameId: 'canonical-gog', name: 'Installed GOG', platform: 'gog', scannerPlatform: 'gog', path: 'C:/Games/GOG/game.exe' };
    const ownedOnly = { id: 'gog_200', name: 'Owned only', platform: 'gog', allIds: { gog: '200' }, ownedByAccountIds: ['g1'] };
    const { sandbox, element } = makeRouletteSandbox([installed, ownedOnly]);

    assert.deepEqual(Array.from(sandbox.window._buildPlayPool(), game => game.id), ['local-gog']);
    sandbox.window.setRouletteMode('play');
    assert.equal(element('spinBtn').disabled, false);
    assert.equal(sandbox.window._roulettePickFinal(sandbox.window._buildPlayPool()).id, 'local-gog');

    sandbox.window._rouletteSetCustomSpinIds(['canonical-gog']);
    assert.deepEqual(Array.from(sandbox.window._buildPlayPool(), game => game.id), ['local-gog']);
    sandbox.window._rouletteSetCustomSpinIds(['not-this-game']);
    assert.equal(sandbox.window._buildPlayPool().length, 0);
});

test('Ready-to-Install Spin includes an eligible GOG suggestion and dedupes canonical merged cards', () => {
    const gog = { id: 'gog_200', title: 'GOG Only', _platform: 'gog', canonicalGameId: 'gog-game', productId: '200' };
    const duplicate = { id: 'gog_200-copy', title: 'GOG Only', _platform: 'gog', canonicalGameId: 'gog-game', productId: '200' };
    const { sandbox } = makeRouletteSandbox([], [gog, duplicate]);
    const pool = sandbox.window._buildInstallPool();
    assert.equal(pool.length, 1);
    assert.equal(pool[0]._platform, 'gog');
    assert.equal(sandbox.window._roulettePickFinal(pool)._raw.id, 'gog_200');
});

function makePanelSandbox(getGogProfiles) {
    const elements = new Map(['steam', 'epic', 'gog', 'ea', 'riot', 'ubisoft', 'discord', 'rockstar']
        .map(platform => [`${platform}Count`, { textContent: 'bad' }]));
    let ready;
    const document = {
        getElementById(id) { return elements.get(id) || null; },
        addEventListener(type, fn) { if (type === 'DOMContentLoaded') ready = fn; },
        querySelector() { return null; }, querySelectorAll() { return []; }, body: { appendChild() {} },
        createElement() { return { style: {}, classList: { add() {}, remove() {} }, querySelector() { return null; }, addEventListener() {}, remove() {} }; },
    };
    const sandbox = { window: null, document, console: { warn() {}, log() {}, error() {} }, setTimeout() { return 1; }, clearTimeout() {}, Promise, Array, Object, String, Number, Date, Map, Set, ipcInvoke: async () => [] };
    sandbox.window = { document, electronAPI: { getSteamAccounts: async () => [], getEpicProfiles: async () => [], getGogProfiles } };
    sandbox.globalThis = sandbox.window;
    vm.createContext(sandbox);
    vm.runInContext(PANELS, sandbox, { filename: 'platform-panels.js' });
    return { sandbox, elements, ready };
}

test('GOG sidebar first frame shares the neutral dash and asynchronous hydration replaces it with the real count', async () => {
    const counts = Object.fromEntries([...HTML.matchAll(/id="(steam|epic|gog)Count">([^<]*)</g)].map(match => [match[1], match[2]]));
    assert.equal(counts.gog, '—');
    assert.equal(counts.gog, counts.steam);
    assert.equal(counts.gog, counts.epic);
    assert.doesNotMatch(HTML, /â€”|�|&mdash;/);

    const { sandbox, elements, ready } = makePanelSandbox(async () => [{ id: 'g1' }, { id: 'g2' }]);
    ready();
    assert.equal(elements.get('gogCount').textContent, '—');
    await sandbox.window.updateAllAccountCounts();
    assert.equal(elements.get('gogCount').textContent, '2');
});

test('failed GOG account-count hydration leaves the neutral dash and never invents zero', async () => {
    const { sandbox, elements, ready } = makePanelSandbox(async () => { throw new Error('offline'); });
    ready();
    await sandbox.window.updateAllAccountCounts();
    assert.equal(elements.get('gogCount').textContent, '—');
});
